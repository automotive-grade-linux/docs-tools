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
    var regexSection = /(\(|src=")(.+\.(jpg|png|pdf|svg))(\)|")/ig;
    //src="images/app-developer-workflow.png"

    var imageRes;
    while ((imageRes = regexSection.exec(contents)) !== null) {
        var image = imageRes[2].replace(/\s+/, "");
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

function handleResponse(url, dst, isTextFile, frontMatter, response, outFile) {
    if (isTextFile) response.setEncoding('utf8');
    else response.setEncoding('binary');

    var fileContents = '';
    //front matter is needed to be proceed by jekyll
    if (frontMatter) fileContents = frontMatter;
    response.on('data', function (data) {
        fileContents += data;
    });
    response.on('end', function () {
        //parse data to get images
        if (isTextFile) {
            parseMarkdown(fileContents, url, dst);
            outFile.end(fileContents);
        }
        else outFile.end(fileContents, 'binary');
    });
}

/*download file*/
function downloadFile(url, dst, isTextFile, frontMatter) {
    if (!fse.existsSync(path.dirname(dst))) { fse.mkdirsSync(path.dirname(dst)); }
    var outFile = fse.createWriteStream(dst);

    if (fse.existsSync(url)) { //local fetch
        var inFile = fse.createReadStream(url);
        handleResponse(url, dst, isTextFile, frontMatter, inFile, outFile);
        outFile.on('finish', function () {
            if (VERBOSE) console.log(" --- Local Fetch " + dst + " done");
        });
        return outFile;
    } else {
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
            handleResponse(url, dst, isTextFile, frontMatter, response, outFile);
            outFile.on('finish', function () {
                if (VERBOSE) console.log(" --- Fetch " + dst + " done");
            });
        }).on('error', function (e) {
            console.error("ERROR: " + e.message);
        });
    }
    return outFile;
}

/*ReadChapters: read chapter section in yml*/
async function ReadChapters(chapters, chapterData) {
    for (var idx in chapters) {
        var chapter = chapters[idx];

        /*if no children in chapter*/
        if (chapter.url) {
            chapter.url = chapter.url.replace("%lang%/", "");
            var dst = path.join(chapterData.dstDir, path.dirname(chapter.url));
            if (!fse.existsSync(dst)) fse.mkdirsSync(dst);
            dst = path.join(dst, path.basename(chapter.url));
            var subId = 0;
            while (fse.existsSync(dst)) { //if file already exists rename it
                var newName = idx.toString() + "." + subId.toString() + "-" + path.basename(chapter.url);
                chapter.url = path.join(path.dirname(chapter.url), newName);
                dst = path.join(chapterData.dstDir, chapter.url);
                if (VERBOSE) console.log(" WARNING: %s already exists renamed into %s", dst, newName);
                subId = parseInt(subId) + 1;
            }

            var url = chapterData.bookConfig.url.replace(path.basename(chapterData.bookConfig.localPath), chapter.url);

            downloadFile(url, dst, true, setFrontMatter(chapter.name));

            var chapterToc = {
                name: chapter.name,
                order: 50,
                url: path.join("reference", chapter.url).replace(".md", ".html"),
            }
            //push new chapterToc for generated yml file
            chapterData.toc.children.push(chapterToc);

            var section = chapterData.section;
            var nbDownload = chapterData.section.mapNbMarkdownDownloaded.get(chapterData.language);
            nbDownload += 1;
            chapterData.section.mapNbMarkdownDownloaded.set(chapterData.language, nbDownload);
        } else if (chapter.children) { //if children call recursively ReadChapters
            var subChapterData = Object.assign({}, chapterData);

            var subToc = {
                name: chapter.name,
                order: 50,
                children: [],
            };
            subChapterData.toc = subToc;
            ReadChapters(chapter.children, subChapterData);
            chapterData.toc.children.push(subToc);
        }
    }
}

function countNumberOfMarkdownChildren(chapters) {
    var nb = 0;
    for (var idx in chapters) {
        var chapter = chapters[idx];
        if (chapter.url) nb += 1;
        if (chapter.children) nb += countNumberOfMarkdownChildren(chapter.children, nb);
    }
    return nb;
}

function countNumberOfMarkdown(section, bookContent, bookConfig) {
    if (!bookConfig.mapNbMarkdown) bookConfig.mapNbMarkdown = new Map();
    var map = bookConfig.mapNbMarkdown;
    for (var idxBook in bookContent.books) {
        var bookLangs = bookContent.books[idxBook];
        /*loop on languages*/
        for (var idxBookLang in bookLangs.languages) {
            var book = bookLangs.languages[idxBookLang];
            var nb = countNumberOfMarkdownChildren(book.chapters);
            if (map.has(book.language))
                nb += map.get(book.language);
            map.set(book.language, nb);
        }
    }

    bookConfig.mapNbMarkdown.forEach(function (value, key, map) {
        var nbTotal = value;
        if (!section.mapNbMarkdownDownloaded.has(key)) {
            section.mapNbMarkdownDownloaded.set(key, 0);
        }
        if (section.mapNbMarkdown.has(key)) {
            nbTotal += section.mapNbMarkdown.get(key);
        }
        section.mapNbMarkdown.set(key, nbTotal);

        if (VERBOSE) {
            console.log("--- In " + bookConfig.fileName + ": Found "
                + value + " markdown files for " + key + " language. The total found is " + section.mapNbMarkdown.get(key));
        }
    });
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

    //countNumberOfMarkdown(section, bookContent, bookConfig);

    /*loop on books*/
    for (var idxBook in bookContent.books) {
        //var bookLangs = bookContent.books[idxBook];
        var order = 50;
        var book = bookContent.books[idxBook];
        if (book.order) order = book.order;
        book.language = config.LANG_DEFAULT;
        var toc = {
            name: book.title,
            id: bookConfig.id,
            order: order,
            children: [],
        };
        var dstDir = path.join(config.DOCS_DIR, book.language, section.version, section.name, config.FETCH_DIR);

        var chapterData = {
            language: book.language,
            toc: toc,
            bookConfig: bookConfig,
            dstDir: dstDir,
            tocsMapLanguage: tocsMapLanguage,
            section: section,
        };
        ReadChapters(book.chapters, chapterData);
        /*push new toc in toc language map*/
        var tocs = tocsMapLanguage.get(book.language);
        if (!tocs) {
            tocs = [];
        }
        if (bookConfig.parent) { //it is a child book
            var tocElement = tocs.find(function (element) {
                console.log("*****" + element.id + "." + bookConfig.id);
                if (element.id == bookConfig.parent)
                    return element;
            });
            if (!tocElement) {
                tocElement = {
                    name: book.title,
                    id: bookConfig.parent,
                    order: 50,
                    children: [],
                };
                tocs.push(tocElement);
            }
            tocElement.children.push(toc);
            tocElement.children.sort(function (toc1, toc2) {
                return toc1.order - toc2.order;
            });
        } else {
            var tocElement = tocs.find(function (element) {
                if (element.id == bookConfig.id)
                    return element;
            });
            if (tocElement && bookConfig.childBook) {
                toc.children.push(tocElement.children);
                tocElement.children.sort(function (toc1, toc2) {
                    return toc1.order - toc2.order;
                });
                tocElement = toc;
            } else {
                tocs.push(toc);
            }
        }
        tocs.sort(function (toc1, toc2) {
            return toc1.order - toc2.order;
        });
        tocsMapLanguage.set(book.language, tocs);
    }
    //TOFIX: better to do it only at the end
    GenerateDataTocsAndIndex(tocsMapLanguage, section);
}

async function downloadBook(url, dst, section, bookConfig, tocsMapLanguage) {
    var outFile = downloadFile(url, dst, true);

    outFile.on("finish", function () {
        ReadBook(section, bookConfig, tocsMapLanguage);
    });
}

/*FetchBooks: fetch books from remote repos, reading section_<version>.yml*/
async function FetchBooks(section, sectionConfig, tocsMapLanguage) {
    var overloadConfig;
    if(fse.existsSync(config.FETCH_CONFIG_OVERLOAD)) {
        overloadConfig = yaml.load(fse.readFileSync(config.FETCH_CONFIG_OVERLOAD));
    }

    /*for each books*/
    for (var idx in sectionConfig.books) {
        var bookConfig = sectionConfig.books[idx];
        if (bookConfig.path) {
            for(var idx in overloadConfig) {
                var overload = overloadConfig[idx];
                if(bookConfig.git_name) {
                    if(overload.git_name==bookConfig.git_name) {
                        bookConfig.url_fetch = path.join(overload.url_fetch, "%source%");
                    }
                }
            }
            if(sectionConfig.parent) bookConfig.parent = sectionConfig.parent;
            if(bookConfig.books) bookConfig.childBook = true;
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
            bookConfig.fileName = bookConfig.id + "-" + path.basename(bookConfig.path);
            bookConfig.localPath = path.join(config.DATA_DIR, "tocs", section.name, bookConfig.fileName);
            downloadBook(url, bookConfig.localPath, section, bookConfig, tocsMapLanguage);
        }
        if(bookConfig.books) {
            var subSectionConfig = sectionConfig;
            subSectionConfig.books = bookConfig.books;
            subSectionConfig.parent = bookConfig.id;
            FetchBooks(section, subSectionConfig, tocsMapLanguage);
        }
    }
}

async function GenerateDataTocsAndIndex(tocsMapLanguage, section) {
    /*generated _toc_<version>_<language>.yml and index.html for each {version, language}*/
    tocsMapLanguage.forEach(function (value, key, map) {
        var output = yaml.dump(value, { indent: 4 });
        var destTocName = util.genTocfileName(key, section.version);
        var tocsPath = path.join(config.DATA_DIR, "tocs", section.name, destTocName);
        fse.writeFileSync(tocsPath, output);

        var dst = path.join(config.DOCS_DIR, key, section.version, section.name);
        if (!fse.existsSync(dst)) fse.mkdirsSync(dst);
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

    FetchBooks(section, sectionConfig, section.tocsMapLanguage);
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
                version: sectionConfArray[1],
                mapNbMarkdown: new Map(),
                mapNbMarkdownDownloaded: new Map(),
                tocsMapLanguage: new Map(),
            };
            ParseSection(argv, section);
        }
    }
}

module.exports = main;
