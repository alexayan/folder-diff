var crypto = require('crypto');
var fs = require('fs');
var Q = require('q');
var path = require('path');
var walk = require('walk');

/**
 * get hash of file
 * @param  {String} fileName file path
 * @return {Object}           hash {'hash':'', file:''}  
 */
function file_hash(fileName){
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
		            	file : fileName
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
			tasks.push(file_hash(name));
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

module.exports = {
  file_hash: file_hash,
  compare_two_file : compare_two_file,
  gen_folder_hash_map : gen_folder_hash_map,
  folder_diff : folder_diff
};