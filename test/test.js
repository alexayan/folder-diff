var assert = require('assert');
var diff = require('..');
var path = require('path');

var file_a = path.resolve(process.cwd(), 'temp/a.html');
var file_b = path.resolve(process.cwd(), 'temp/b.html');
var file_c = path.resolve(process.cwd(), 'temp/c.html');

describe('folder-diff test', function () {
  it('should equal', function (){
    return diff.compare_two_file(file_a, file_b).then(function(res){
  		assert.equal(true, res);
	});
  });

  it('should not equal', function () {
    return diff.compare_two_file(file_a, file_c).then(function(res){
		assert.equal(false, res);
	});
  });
});
