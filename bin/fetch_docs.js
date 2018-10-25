// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

"use strict";

var fs            = require("fs");
var fse           = require("fs-extra");
var path          = require("path");
var util          = require("util");
var child_process = require("child_process");
var yaml          = require("js-yaml");
var helpers       = require("../lib/misc_helpers");
var Writable      = require('stream').Writable;
var config;
var getCount;
var errorCount;
var doneCB;

function mkdirp (p) {

    if (fs.existsSync(p)) return;
    var ptree= p.split('/');

    for (var idx=0; idx < ptree.length; idx++) {
        var dirpath = ptree.slice(0,idx).join('/');
        console.log ("idx=%s", idx, dirpath);
        if (!fs.existsSync(dirpath)) fs.mkdir (dirpath);
    }
}

function isTextFile(p) {
    var ext=path.extname(p);
    // some extensions are not really extensions if they are too long.
    // for example, for 'README.proprietary', we should consider that the extension is empty
    if (ext.length>4) ext="";

    return (0
        || (ext==".md")
        || (ext==".txt")
        || (ext=="")
    );
}

function getFrontMatter(text) {
    var frontMatterString = helpers.getFrontMatterString(text);
    if (frontMatterString !== null) {
        return yaml.load(frontMatterString);
    }
    return {};
}

function setFrontMatter(text, frontMatter, options) {
    var frontMatterString = yaml.dump(frontMatter, options);
    return helpers.setFrontMatterString(text, frontMatterString);
}


function localCopy (argv, repo, document) {
    var srcURI = repo.url_fetch.replace ("%source%", path.join (repo.src_prefix, document.source));
    if (!document.destination) document.destination= path.join (repo.destination, document.source);
    else document.destination = path.join(repo.destination, document.destination);

    var outFileDir  = path.dirname(document.destination);
    // create directory for the file if it doesn't exist
    if (!fs.existsSync(outFileDir)) fse.mkdirsSync(outFileDir);

    if (path.extname(srcURI)===".md"){
        // open the file for writing
        var outFile = fs.createWriteStream(document.destination);
        var editURI  = ""
        if (repo.url_edit) {
            editURI = repo.url_edit.replace  ("%source%", path.join (repo.src_prefix, document.source));
        }
        // start a default front master
        var newFrontMatter = {
            edit_link: document.edit  || editURI || "",
            title:     document.title || document.label,
            origin_url: srcURI
        };
        var fileContents = '';
        var fileContents = fs.readFileSync(srcURI, 'utf8');

        // merge new front matter and file's own front matter (if it had any)
        //
        // NOTE:
        //      newFrontMatter's properties should override those of fileFrontMatter
        var fileFrontMatter   = getFrontMatter(fileContents);
        var mergedFrontMatter = helpers.mergeObjects(fileFrontMatter, newFrontMatter);

        // add a warning and set the merged file matter in the file
        var contentsOnly = helpers.stripFrontMatter(fileContents);
        contentsOnly     = repo.warning + contentsOnly;

        var augmentedContents = setFrontMatter(contentsOnly, mergedFrontMatter);

        // write out the file
        outFile.end(augmentedContents);
    } else {
        fse.copy(srcURI, document.destination);
    }
}

function downloadEntry(argv, repo, document) {
    if (!document.destination) document.destination= path.join (repo.destination, document.source);
    else document.destination = path.join(repo.destination, document.destination);
    var outFileDir  = path.dirname(document.destination);

    // If no Label Build one from source file name
    if (!document.label) {
        var label=path.basename (document.source, ".md");
        label = label.split (/(?:-|_)+/);
        document.label = label.join (" ");
   };

    // build fetch URI
    var fetchURI = repo.url_fetch.replace ("%source%", path.join (repo.src_prefix, document.source));
    if (repo.url_edit) var editURI  = repo.url_edit.replace  ("%source%", path.join (repo.src_prefix, document.source));

    // start a default front master
    var newFrontMatter = {
        edit_link: document.edit  || editURI || "",
        title:     document.title || document.label,
        origin_url: fetchURI
    };

    // create directory for the file if it doesn't exist
    if (!fs.existsSync(outFileDir)) fse.mkdirsSync(outFileDir);

    // open the file for writing
    var outFile = fs.createWriteStream(document.destination);
    getCount ++;

    if (argv.verbose) console.log ("      < src=%s", fetchURI);

    // open an HTTP request for the file
    var protocol;
    if (fetchURI.startsWith("http:")) {
        protocol=require("http");
    }
    else if (fetchURI.startsWith("https:")) {
        protocol=require("https");
    }
    else {
        console.error("ERROR: " + fetchURI + ": protocol not recognized");
    }
    var request= protocol.get(fetchURI, function (response) {

        if (argv.verbose) console.log ("      > dst=%s", document.destination);

        if (response.statusCode !== 200) {
            console.error("ERROR: " + fetchURI + ": got %s errCount=%d", response.statusCode, errorCount);
            errorCount++;
        }

        // read in the response
        var fileContents = '';
        if (isTextFile(document.source))
            response.setEncoding('utf8');
        else
            response.setEncoding('binary');

        response.on('data', function (data) {
            fileContents += data;
        });

        // process the response when it finishes
        response.on('end', function () {

            if (isTextFile(document.source)) {
                // merge new front matter and file's own front matter (if it had any)
                //
                // NOTE:
                //      newFrontMatter's properties should override those of fileFrontMatter
                var fileFrontMatter   = getFrontMatter(fileContents);
                var mergedFrontMatter = helpers.mergeObjects(fileFrontMatter, newFrontMatter);

                // add a warning and set the merged file matter in the file
                var contentsOnly = helpers.stripFrontMatter(fileContents);
                contentsOnly     = repo.warning + contentsOnly;

                var augmentedContents = setFrontMatter(contentsOnly, mergedFrontMatter);

                // write out the file
                outFile.end(augmentedContents);
            }
            else {
                // write out the file with frontmatter (not a markdown file)
                outFile.end(fileContents,'binary');
            }

            outFile.on('finish', function() {
                getCount --;

                if (getCount === 0) {
                    if (argv.verbose) console.log ("  + Fetch done");
                    if (doneCB) doneCB();
                }
            });
        });

    }); // http request

    request.on ('error', function(e) {
            console.error("Hoop: fetch URL=%s fail err=[%s]", fetchURI,  e);
            errorCount ++;
    });
}

// main
function FetchFiles (argv, item, fetchconf, version) {
    var targetVersion  = config.VERSION_TAGDEV;
    var targetLanguage = config.LANG_DEFAULT;
    var destination    = path.join (config.DOCS_DIR, item, targetLanguage, targetVersion, config.FETCH_DIR);

    // get config
    var fetchConfig   = fs.readFileSync(fetchconf);
    try {
        var tocConfig = yaml.load(fetchConfig);
    } catch (error) {
        console.log ("ERROR: reading [%s] error=[%s]", fetchconf, error);
        process.exit(1);
    }

    var overloadConfig;
    if(fs.existsSync(config.FETCH_CONFIG_OVERLOAD)) {
        overloadConfig = yaml.load(fs.readFileSync(config.FETCH_CONFIG_OVERLOAD));
        console.log(overloadConfig);
    }


    // get version
    if (fs.existsSync (version)) {
        var fetchVersion   = fs.readFileSync(version);
        try {
            var latest = yaml.load(fetchVersion).latest_version;
        } catch (error) {
            console.log ("ERROR: reading [%s] error=[%s]", version, error);
            process.exit(1);
        }
    }

    if (argv.verbose) {
        console.log ("  + FetchConfig = [%s]", fetchconf);
        console.log ("    + Destination = [%s]", destination);
    }
    if (!fs.existsSync(destination)) fse.mkdirsSync(destination);

    var global = {
        url_fetch  : tocConfig.url_fetch,
        url_edit   : tocConfig.url_edit,
        git_commit : tocConfig.git_commit || latest || "master",
        destination: path.join (destination, tocConfig.dst_prefix || ""),
        src_prefix : tocConfig.src_prefix || ""
    };

    if (!tocConfig.repositories) {
        console.log ("    * WARNING: no repositories defined in %s",fetchconf);
        return;
    }

    for  (var idx in tocConfig.repositories) {
        var repository =  tocConfig.repositories[idx];
        var repodest;

        for(var idx in overloadConfig) {
            var overload = overloadConfig[idx];
            if(repository.git_name) {
                if(overload.git_name==repository.git_name) {
                    repository.url_fetch = overload.url_fetch;
                }
            }
        }



        if (repository.dst_prefix) repodest= path.join (destination, repository.dst_prefix || "");
        else repodest=global.destination;

        var git_name_src ;

        if (repository.git_name)
        {
            git_name_src=repository.git_name.replace ("%project_source%" , config.AGL_SRC);
        }
        var repo= {
            url_fetch  : repository.url_fetch  || global.url_fetch,
            url_edit   : repository.url_edit   || global.url_edit,
            git_commit : repository.git_commit || global.git_commit,
            src_prefix : repository.src_prefix || global.src_prefix,
            git_name   : git_name_src,
            destination: repodest,
            warning    : util.format ("<!-- WARNING: This file is generated by %s using %s -->\n\n", path.basename(__filename),fetchconf)
        };

        var do_local_copy = false;

        if ( repo.url_fetch === "AGL_GITHUB_FETCH" && argv.localFetch===true){
            repo.url_fetch= path.join (path.dirname(path.dirname(config.SITE_DIR)), "%source%");
            do_local_copy=true;
        } else {
            // Support url_fetch = local directory in order to allow user to test
            // changes using local directory / git repo
            try {
                if (fs.statSync(repo.url_fetch).isDirectory()) {
                    repo.url_fetch= path.join (repo.url_fetch, "%source%");
                    do_local_copy=true;
                }
            } catch (err) {}

            if (!do_local_copy) {
                // get url from config is default formating present in config
                if (config[repo.url_fetch]) repo.url_fetch = config[repo.url_fetch];
                do_local_copy=false;
            }
        }

        if (config[repo.url_edit])  repo.url_edit  = config[repo.url_edit];
        if (config[repo.git_name])  repo.git_name  = config[repo.git_name];
        repo.url_fetch= repo.url_fetch.replace ("%repo%"  , repo.git_name);
        if (config[repo.git_commit])  repo.git_commit  = config[repo.git_commit];
        repo.url_fetch= repo.url_fetch.replace ("%commit%", repo.git_commit);

        if (repo.url_edit) {
            repo.url_edit= repo.url_edit.replace ("%repo%"  , repo.git_name);
            repo.url_edit= repo.url_edit.replace ("%commit%", repo.git_commit);
        }

        if (argv.verbose || argv.dumponly) {
            console.log ("    + Fetching Repo=%s", repo.url_fetch);
        }

        // if destination directory does not exist create it
        if (!fs.existsSync(repo.destination)) fse.mkdirsSync(repo.destination);
        else {
            if (!argv.force) {
                console.log ("      * WARNING: use [--force/--clean] to overload Fetchdir [%s]", repo.destination);
                process.exit(1);
            } else {
                console.log ("      * WARNING: overloaded Fetchdir [%s]", repo.destination);
            }
        }

        for  (var jdx in repository.documents) {
            var document = repository.documents[jdx];
            if (do_local_copy===true) {
                 localCopy (argv, repo, document);
            }
            else {
                if (argv.dumponly) {
                   console.log ("      + label=%s src=%s dst=%s", document.label, document.src, document.dst);
                } else {
                   downloadEntry (argv, repo, document);
                }
            }
        };
    };
}

function main (conf, argv, nextRequest) {
    config    = conf;  // make config global
    getCount  = 0;     // Global writable active Streams
    errorCount=0;
    doneCB = nextRequest;

    // open destination _default.yml file
    var destdir = path.join (config.DATA_DIR, "tocs");
    if(!fs.existsSync(destdir)) fse.mkdirsSync(destdir);

    var tocs = fs.readdirSync(config.TOCS_DIR);
    for (var item in tocs) {
        var tocDir   = path.join (config.TOCS_DIR, tocs[item]);
        var fetchconf= path.join (config.TOCS_DIR, tocs[item], config.FETCH_CONFIG);
        var version  = path.join (config.TOCS_DIR, tocs[item], config.VERSION_LATEST);

        if (fs.existsSync(fetchconf)) {
            FetchFiles (argv, tocs[item], fetchconf, version);
        } else {
            console.log ("HOOP: Ignore toc=[%s/%s] not readable", tocs[item], config.FETCH_CONFIG);
        }
    }

    if (argv.verbose) console.log ("  + fetch_docs in progress count=%d", getCount);
    return true; // do not run nextRequest imediatly
}

module.exports = main;
