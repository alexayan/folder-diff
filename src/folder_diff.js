var crypto = require('crypto');
var fs = require('fs');
var Q = require('q');
var path = require('path');
var walk = require('walk');
var AdmZip = require('adm-zip');
var archiver = require('archiver');
var bsdiff = require('node-bsdiff');

/**
 * get hash of file
 * @param  {String} fileName file path
 * @return {Object}           hash {'hash':'', file:''}  
 */
function file_hash(fileName, folder){
	return Q.Promise(function(resolve, reject, notify){
		fs.exists(fileName, function (exists) {
			if(exists){
				resolve();
			}else{
				reject();
			}
		});
	}).then(function(){
		return Q.Promise(function(resolve, reject, notify){
			try{
				var stream = fs.ReadStream(fileName);
		        var hash = crypto.createHash('md5');
		        var res;
		        stream.on('data', function(data){
		            hash.update(data);
		        });
		        stream.on('end', function (){
		            res = hash.digest('hex');
		            resolve({
		            	hash : res,
		            	file : fileName,
		            	folder : folder
		            });
		        });
			}catch(e){
				reject();
			}
		});
	})
}

/**
 * compare two file 
 * @param  {String} fileA file path
 * @param  {String} fileB file path
 * @return {Boolean}      equal?
 */
function compare_two_file(fileA, fileB){
	return Q.all([file_hash(fileA), file_hash(fileB)]).then(function(res){
		return res[0].hash === res[1].hash;
	});
}

/**
 * generate the hash map of folder
 * @param  {String} folder folder path
 * @return {Object}        hash map {'filename': {'file':'', 'hash':''}, ...}
 */
function gen_folder_hash_map(folder){
	var map = {};
	return Q.Promise(function(resolve, reject, notify){
		var walker  = walk.walk(folder, { followLinks: false }),
			files = [];
		walker.on('file', function(root, stat, next){
			files.push(root + '/' + stat.name);
			next();
		});
		walker.on('end', function(){
			resolve(files);
		});
		walker.on("errors", function(root, nodeStatsArray, next){
			reject(nodeStatsArray);
			next();
		});
	}).then(function(files){
		var tasks = [];
		files.forEach(function(name){
			name = path.resolve(folder, name);
			tasks.push(file_hash(name, folder));
	    });
	    return Q.all(tasks);
	}).then(function(res){
		res.forEach(function(item){
			map[item.file] = item;
		});
		return map;
	});
}

function path_transform(old_path, old_path_dir, new_path_dir){
	var relative_path = path.relative(old_path_dir, old_path);
	return path.resolve(new_path_dir, relative_path);
}

function path_transform_new_to_old(new_path, old_path_dir, new_path_dir){
	var relative_path = path.relative(new_path_dir, new_path);
	return path.resolve(old_path_dir, relative_path);
}


/**
 * generate the change log betwenn two folder
 * @param  {String} folder_old old folder path
 * @param  {String} folder_new new folder path
 * @return {Object}            change log {'filename' : {'hash': '', 'file': '', 'type': ''}, ...}
 */
function folder_diff(folder_old, folder_new){
	return Q.all([gen_folder_hash_map(folder_old), gen_folder_hash_map(folder_new)]).then(function(res){
		var old_map = res[0],
			new_map = res[1];
		for(var prop in old_map){
			old_map[prop].type = 'delete';
		}
		for(var prop in new_map){
			var old_prop = path_transform(prop, folder_new, folder_old);
			if(old_map[old_prop]){
				if(old_map[old_prop].hash==new_map[prop].hash){
					delete old_map[old_prop];
				}else{
					delete old_map[old_prop];
					old_map[prop] = new_map[prop];
					old_map[prop].type = 'modify';
				}
			}else{
				delete old_map[old_prop];
				old_map[prop] = new_map[prop];
				old_map[prop].type = 'add';
			}
		}
		return old_map;
	});
}

function zip_diff(r_old, r_new, opt){
	var temp_dir_old = '/tmp/old_diff_dir',
		temp_dir_new = '/tmp/new_diff_dir',
		zip_old = new AdmZip(r_old),
		zip_new = new AdmZip(r_new);
	deleteFolderRecursive(temp_dir_old);
	deleteFolderRecursive(temp_dir_new);
	zip_old.extractAllTo(temp_dir_old, true);
	zip_new.extractAllTo(temp_dir_new, true);
	return diff(temp_dir_old, temp_dir_new, opt);
}

/**
 * diff folders or zip files , return zip buffer
 * @param  {String} r_old old path
 * @param  {String} r_new new path
 * @return {Buffer}       patch buffer
 */
function diff(r_old, r_new, opt){
	opt = opt || {};
	if(path.extname(r_old)==='.zip' && path.extname(r_new)==='.zip'){
		return zip_diff(r_old, r_new, opt);
	}else{
		try{
			return folder_diff(r_old, r_new).then(function(map){
				if(opt.bsdiff){
					return createBsdiffArchiver(r_old, r_new, map);
				}else{
					return createNomalArchiver(r_old, r_new, map);
				}
			});
		}catch(e){
			var deferred = Q.defer();
			deferred.reject(e);
			return deferred.promise;
		}
	}
}

function createBsdiffArchiver(r_old, r_new, map){
	var archive = archiver('zip');			
	var arr = [];
	for(var prop in map){
		if(map[prop].type==='add'){
			archive.append(fs.createReadStream(prop), { name: prop.replace(r_new, '')});
			map[prop].algorithm = 'normal';
		}else if(map[prop].type==='modify'){
			archive.append(bsdiff.diff(
				fs.readFileSync(path_transform_new_to_old(prop, r_old, r_new)),
				fs.readFileSync(prop)
			), { name: prop.replace(r_new, '')});
			map[prop].algorithm = 'bsdiff';
		}else{
			map[prop].algorithm = 'normal';
		}
		map[prop].file = path.relative(map[prop].folder, map[prop].file);
		arr.push(map[prop]);
	}
	archive.append(new Buffer(JSON.stringify(arr), 'utf-8'), { name: 'config.json'});
	archive.finalize();
	return archive;
}

function createNomalArchiver(r_old, r_new, map){
	var archive = archiver('zip');			
	var arr = [];
	for(var prop in map){
		if(map[prop].type!=='delete'){
			archive.append(fs.createReadStream(prop), { name: prop.replace(r_new, '')});
		}
		map[prop].file = path.relative(map[prop].folder, map[prop].file);
		map[prop].algorithm = 'normal';
		arr.push(map[prop]);
	}
	archive.append(new Buffer(JSON.stringify(arr), 'utf-8'), { name: 'config.json'});
	archive.finalize();
	return archive;
}

function deleteFolderRecursive(path) {
    var files = [];
    if( fs.existsSync(path) ) {
        files = fs.readdirSync(path);
        files.forEach(function(file,index){
            var curPath = path + "/" + file;
            if(fs.statSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else { 
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

module.exports = {
  file_hash: file_hash,
  compare_two_file : compare_two_file,
  gen_folder_hash_map : gen_folder_hash_map,
  folder_diff : folder_diff,
  diff : diff
};