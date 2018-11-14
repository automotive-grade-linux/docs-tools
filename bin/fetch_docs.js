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

var fse = require("fs-extra");
var path = require("path");
var util = require("util");
var yaml = require("js-yaml");
var util = require("../lib/misc_helpers");
var config;
var doneCB;
var VERBOSE;

//parse markdown to get images
async function parseMarkdown(contents, url, pathMd) {
    var regexSection = /\((.+\.(jpg|png|pdf|svg))\)/ig;

    var imageRes;
    while ((imageRes = regexSection.exec(contents)) !== null) {
        var image = imageRes[1].replace(/\s+/, "");
        //ignore links
        if (!image.startsWith("http")) {
            var imageUrl = url.replace(path.basename(pathMd), image);
            var imageDst = path.join(path.dirname(pathMd), image);
            downloadFile(imageUrl, imageDst, false);
        }
    }
}

/*needed to be proceed by jekyll*/
function setFrontMatter(title) {
    return "---\ntitle: " + title + "\n---\n";
}

/*download file*/
function downloadFile(url, dst, isTextFile, frontMatter) {
    if (!fse.existsSync(path.dirname(dst))) { fse.mkdirsSync(path.dirname(dst)); }
    var outFile = fse.createWriteStream(dst);

    var protocol;
    if (url.startsWith("http:")) protocol = require("http");
    else if (url.startsWith("https:")) protocol = require("https");
    else {
        console.error("ERROR: " + url + ": protocol not recognized");
        return;
    }
    protocol.get(url, function (response) {
        if (response.statusCode !== 200) {
            console.error("ERROR: " + url + ": got %s", response.statusCode);
            return;
        }

        if (isTextFile) response.setEncoding('utf8');
        else response.setEncoding('binary');

        var fileContents = '';
        //front matter is needed to be proceed by jekyll
        if (frontMatter) fileContents = frontMatter;
        response.on('data', function (data) {
            //parse data to get images
            parseMarkdown(data, url, dst);
            fileContents += data;
        });
        response.on('end', function () {
            if (isTextFile) outFile.end(fileContents);
            else outFile.end(fileContents, 'binary');
        });

        outFile.on('finish', function () {
            if (VERBOSE) console.log(" --- Fetch " + dst + " done");
        });
    });
    return outFile;
}

async function downloadBook(url, dst, section, bookConfig, tocsMapLanguage) {
  var outFile = downloadFile(url, dst, true);

  outFile.on("finish", function() {
    if(VERBOSE) console.log(" --- Fetch " + bookConfig.localPath + " done");
    ReadBook(section, bookConfig, tocsMapLanguage);
    if (parseInt(bookConfig.idNb) + 1 == bookConfig.nbBooks)
      GenerateDataTocsAndIndex(tocsMapLanguage, section);
  });
}

/*ReadChapters: read chapter section in yml*/
async function ReadChapters(chapters, toc, bookConfig, dstDir) {
    for (var idx in chapters) {
        var chapter = chapters[idx];

        /*if no children in chapter*/
        if (!chapter.children) {

            var dst = path.join(dstDir, path.dirname(chapter.url));
            if (!fse.existsSync(dst)) fse.mkdirsSync(dst);
            dst = path.join(dst, path.basename(chapter.url));
            var subId = 0;
            while (fse.existsSync(dst)) { //if file already exists rename it
                var newName = idx.toString() + "." + subId.toString() + "-" + path.basename(chapter.url);
                chapter.url = path.join(path.dirname(chapter.url), newName);
                dst = path.join(dstDir, chapter.url);
                if(VERBOSE) console.log(" WARNING: %s already exists renamed into %s", dst, newName);
                subId = parseInt(subId) + 1;
            }

            var url = bookConfig.url.replace(path.basename(bookConfig.localPath), chapter.url);

            downloadFile(url, dst, true, setFrontMatter(chapter.name));

            var chapterToc = {
                name: chapter.name,
                url: path.join("reference", chapter.url).replace(".md", ".html"),
            }
            //push new chapterToc for generated yml file
            toc.children.push(chapterToc);
        } else { //if children call recursively ReadChapters
            var subToc = {
                name: chapter.name,
                children: [],
            };
            ReadChapters(chapter.children, subToc, bookConfig, dstDir);
            toc.children.push(subToc);
        }
    }
}

/*ReadBook: read a book yml file*/
async function ReadBook(section, bookConfig, tocsMapLanguage) {
    // get book
    try {
        var bookContent = yaml.load(fse.readFileSync(bookConfig.localPath));
    } catch (error) {
        console.error("ERROR: reading [%s] error=[%s]", bookConfig.localPath, error);
        process.exit(1);
    }

    /*loop on books*/
    for (var idxBook in bookContent.books) {
        var bookLangs = bookContent.books[idxBook];
        /*loop on languages*/
        for (var idxBookLang in bookLangs.languages) {
            var book = bookLangs.languages[idxBookLang];
            var toc = {
                name: book.title,
                children: [],
            };
            var dstDir = path.join(config.DOCS_DIR, section.name, book.language, section.version, config.FETCH_DIR);

            ReadChapters(book.chapters, toc, bookConfig, dstDir);

            /*push new toc in toc language map*/
            var tocs = tocsMapLanguage.get(book.language);
            if (!tocs) {
                tocs = [];
            }
            tocs.push(toc);
            tocsMapLanguage.set(book.language, tocs);
        }
    }
}

/*FetchBooks: fetch books from remote repos, reading section_<version>.yml*/
async function FetchBooks(section, sectionConfig, tocsMapLanguage) {
    /*for each books*/
    for (var idx in sectionConfig.books) {
        var bookConfig = sectionConfig.books[idx];
        bookConfig.idNb = idx;
        bookConfig.nbBooks = sectionConfig.books.length;
        var url = bookConfig.url_fetch || sectionConfig.url_fetch;
        url = url.replace("AGL_GITHUB_FETCH", config.AGL_GITHUB_FETCH);
        url = url.replace("GERRIT_FETCH", config.GERRIT_FETCH);
        url = url.replace("%repo%", bookConfig.git_name);
        url = url.replace("%commit%", (bookConfig.git_commit || sectionConfig.git_commit));
        url = url.replace("%source%", bookConfig.path);
        url = url.replace("AGL_GITHUB_BRANCH", config.AGL_GITHUB_BRANCH);
        url = url.replace("AGL_GERRIT_BRANCH", config.AGL_GERRIT_BRANCH);

        bookConfig.url = url;
        bookConfig.localPath = path.join(config.DATA_DIR, "tocs", section.name, path.basename(bookConfig.path));
        downloadBook(url, bookConfig.localPath, section, bookConfig, tocsMapLanguage);
    }
}

async function GenerateDataTocsAndIndex(tocsMapLanguage, section) {
    /*generated _toc_<version>_<language>.yml and index.html for each {version, language}*/
    tocsMapLanguage.forEach(function (value, key, map) {
        var output = yaml.dump(value, { indent: 4 });
        var destTocName = util.genTocfileName(key, section.version);
        var tocsPath = path.join(config.DATA_DIR, "tocs", section.name, destTocName);
        fse.writeFileSync(tocsPath, output);

        var dst = path.join(config.DOCS_DIR, section.name, key, section.version);
        var idxpath = path.join(dst, "index.html");
        var buf = "---\n";
        buf += "title: " + section.title + "\n";
        buf += "---\n\n";
        buf += "{% include generated_index.html %}\n";
        fse.writeFileSync(idxpath, buf);
    });
}

async function ParseSection(argv, section) {
    // get section
    try {
        var sectionConfig = yaml.load(fse.readFileSync(section.file));
    } catch (error) {
        console.error("ERROR: reading [%s] error=[%s]", section.file, error);
        process.exit(1);
    }
    section.title = sectionConfig.name;

    /*tocsMapLanguage: key is language, value is toc to be generated*/
    var tocsMapLanguage = new Map();

    FetchBooks(section, sectionConfig, tocsMapLanguage);
}

function main(conf, argv, nextRequest) {
    config = conf;  // make config global
    doneCB = nextRequest;
    VERBOSE = argv.verbose;

    // open destination _default.yml file
    var destdir = path.join(config.DATA_DIR, "tocs");
    if (!fse.existsSync(destdir)) fse.mkdirsSync(destdir);

    var tocs = fse.readdirSync(config.TOCS_DIR);
    for (var item in tocs) {
        var tocDir = path.join(config.TOCS_DIR, tocs[item]);
        var regexSection = /section_(\w+)\.yml/g;
        var sectionsConf = fse.readdirSync(tocDir);
        var sectionConfArray
        while ((sectionConfArray = regexSection.exec(sectionsConf)) !== null) {
            var section = {
                name: tocs[item],
                nameFile: sectionConfArray[0],
                path: path.join(config.TOCS_DIR, tocs[item]),
                file: path.join(config.TOCS_DIR, tocs[item], sectionConfArray[0]),
                version: sectionConfArray[1]
            };
            ParseSection(argv, section);
        }
    }
}

module.exports = main;
