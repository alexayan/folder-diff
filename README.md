# folder-diff

make diff between two folder, gen patch file what describe the difference of folders

support Asynchronous

## install 

```shell
npm install node-folder-diff
```

## api

```javascript
var diff = require('node-folder-diff');
diff.folder_diff(old_folder_path, new_folder_path).then(function(map){
    //process map
});
```