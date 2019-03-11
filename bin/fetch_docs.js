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
var helpers = require("../lib/misc_helpers");
var config;
var doneCB;
var VERBOSE;
var DEFAULT_ORDER = 50;

//parse markdown to get images
async function parseMarkdown(contents, url, pathMd) {

    var regexArr = [
        // Match reference   ![make-units](pictures/make-units.svg)
        /\[.*\]\((.*\.(jpg|png|pdf|svg)).*\)/ig,

        // Match reference   [afm-daemons]: pictures/afm-daemons.svg
        /\[.*\]: *(.*\.(jpg|png|pdf|svg))/ig,
    ];

    regexArr.forEach(function(rx) {
        var imageRes;
        while ((imageRes = rx.exec(contents)) !== null) {
            var image = imageRes[1].replace(/\s+/, "");
            //ignore links
            if (!image.startsWith("http")) {
                var imageUrl = url.replace(path.basename(pathMd), image);
                var imageDst = path.join(path.dirname(pathMd), image);
                downloadFile(imageUrl, imageDst, false);
            }
        }
    });
}

/*needed to be proceed by jekyll*/
function setFrontMatter(fetchconf, frontMatter, options) {
    var frontMatterString = yaml.dump(frontMatter, options);
    var text =  util.format ("<!-- WARNING: This file is generated by %s using %s -->\n\n", path.basename(__filename), fetchconf);

    return helpers.setFrontMatterString(text, frontMatterString);
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
            process.exit(-1);
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
            process.exit(-1);
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
            var url, dst, dstFilename, pathDirName;

            // FIXME: for now don't support any lang
            chapter.url = chapter.url.replace("%lang%/", "");
            dstFilename = path.basename(chapter.url);

            // Build source url and dst file
            if(isPdf(chapter.url)) {
                pathDirName = "";
                dst = chapterData.dstDir;
            } else {
                pathDirName = path.dirname(chapter.url);
                dst = path.join(chapterData.dstDir, pathDirName);
            }

            // dst_prefix : common destination prefix directory
            if (chapterData.bookConfig.dst_prefix && chapterData.bookConfig.dst_prefix != "") {
                dst = path.join(chapterData.dstDir, chapterData.bookConfig.dst_prefix, pathDirName);
            }

            // src_prefix : common source prefix directory for all url of a chapter
            if (chapterData.src_prefix && chapterData.src_prefix != "") {
                chapter.url = path.join(chapterData.src_prefix, chapter.url)
            }

            // destination : allow to rename markdown filename in website
            if (chapter.destination && chapter.destination != "") {
                dstFilename = chapter.destination;
            }

            if(isPdf(chapter.url)) {
                url = chapter.url;
            } else {
                url = chapterData.bookConfig.url.replace(path.basename(chapterData.bookConfig.url), chapter.url);
            }
            dst = path.join(dst, dstFilename);

            if (fse.existsSync(dst)) {
                console.error("ERROR destination file already exists :");
                console.error("  fetch url :", url);
                console.error("  destination file :", dst);
                process.exit(-2);
            }
            /* TODO: cleanup if ok to have unique files
            var subId = 0;
            while (fse.existsSync(dst)) { //if file already exists rename it
                var newName = idx.toString() + "." + subId.toString() + "__" + path.basename(chapter.url);
                dst = path.join(chapterData.dstDir,  path.join(path.dirname(chapter.url), newName));
                if (VERBOSE) console.log(" WARNING: %s already exists renamed into %s", dst, newName);
                subId = parseInt(subId) + 1;
            }
            */

            if (!fse.existsSync(dst)) fse.mkdirsSync(path.dirname(dst));

            var editURI  = ""
            if (chapterData.url_edit) {
                editURI = chapterData.url_edit.replace  ("%source%", path.join (chapterData.src_prefix, chapter.url));
            }

            var newFrontMatter = {
                edit_link: editURI || "",
                title:     chapter.name,
                origin_url: url,
            };

            var newUrl;
            if(url.endsWith(".pdf")) {
                downloadFile(url, dst, false, "");
                newUrl = path.join("reference", path.relative(chapterData.dstDir, dst));
            }else {
                downloadFile(url, dst, true, setFrontMatter(chapterData.bookConfig.localPath, newFrontMatter));
                newUrl = path.join("reference", path.relative(chapterData.dstDir, dst)).replace(".md", ".html");
            }

            var order = chapter.order ? chapter.order : DEFAULT_ORDER;
            if(chapterData.bookConfig.brother != chapterData.bookConfig.id) {
                order = chapterData.bookConfig.order ? chapterData.bookConfig.order : order;
            }
            var chapterToc = {
                name: chapter.name,
                order: order,
                orderBook: 0,
                url: newUrl,
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
                order: chapter.order ? chapter.order : DEFAULT_ORDER,
                orderBook: 0,
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

function createBookPdf(bookConfig) {
    var bookContent = {};
    if (!bookConfig.name) {
        bookConfig.name = path.basename(bookConfig.path).replace(".pdf", "");
    }
    var chp = {
        name: bookConfig.name,
        url: bookConfig.path,
    };
    var bk = {
        title: bookConfig.name,
        chapters: [chp],
    };
    bookContent.books = [];
    bookContent.books.push(bk);
    return bookContent;
}

function handleTocs(section, bookConfig, book, toc) {
    /*push new toc in toc language map*/
    var tocs = section.tocsMapLanguage.get(book.language);
    if (!tocs) {
        tocs = [];
    }
    var currentId;

    if(bookConfig.brother) {
        toc.id = bookConfig.brother;
        //looking for brothers
        var tocBrother = tocs.find(function (element) {
            if (element.id == bookConfig.brother)
                return element;
        });
        if(tocBrother) {
            //big brother
            if(bookConfig.id == bookConfig.brother) {
                toc.children = toc.children.concat(tocBrother.children);
                toc.children.sort(function (toc1, toc2) {
                    return toc1.orderBook - toc2.orderBook;
                });
                var idxBrother = tocs.indexOf(tocBrother);
                if (idxBrother < 0) {
                    console.error("ERROR: " + idxTocs + ": < 0, tocBrother not found");
                    process.exit(-1);
                }
                tocs[idxBrother] = toc;
            } else {
                tocBrother.children = tocBrother.children.concat(toc.children);
                tocBrother.children.sort(function (toc1, toc2) {
                    return toc1.orderBook - toc2.orderBook;
                });
            }
        } else {
            tocs.push(toc);
        }
    }
    if (bookConfig.parent) { //it is a child book
        var tocElement = tocs.find(function (element) {
            if (element.id == bookConfig.parent)
                return element;
        });
        if (!tocElement) { //no parent found for now
            tocElement = {
                name: book.title,
                id: bookConfig.parent,
                order: bookConfig.order ? bookConfig.order : DEFAULT_ORDER,
                orderBook: bookConfig.idNb,
                children: [],
            };
            tocs.push(tocElement);
        }
        tocElement.children.push(toc);
        tocElement.children.sort(function (toc1, toc2) {
            return toc1.orderBook - toc2.orderBook;
        });
    } else { //parent book
        var tocElement = tocs.find(function (element) {
            if (element.id == bookConfig.id)
                return element;
        });
        if (tocElement && tocElement != toc && bookConfig.childBook) {
            toc.children = toc.children.concat(tocElement.children);
            tocElement.children.sort(function (toc1, toc2) {
                return toc1.orderBook - toc2.orderBook;
            });
            var idxTocs = tocs.indexOf(tocElement);
            if (idxTocs < 0) {
                console.error("ERROR: " + idxTocs + ": < 0, tocElement not found");
                process.exit(-1);
            }
            tocs[idxTocs] = toc;
            //tocElement = toc;
        } else if(!bookConfig.brother){
            tocs.push(toc);
        }
    }
    tocs.sort(function (toc1, toc2) {
        return toc1.orderBook - toc2.orderBook;
    });
    section.tocsMapLanguage.set(book.language, tocs);
}

/*ReadBook: read a book yml file*/
async function ReadBook(section, bookConfig) {
    var bookContent = {};
    // get book
    if(isPdf(bookConfig.path)) {
        bookContent = createBookPdf(bookConfig);
    } else {
        try {
            bookContent = yaml.load(fse.readFileSync(bookConfig.localPath));
        } catch (error) {
            console.error("ERROR: reading [%s] error=[%s]", bookConfig.localPath, error);
            process.exit(1);
        }
    }

    //countNumberOfMarkdown(section, bookContent, bookConfig);

    /*loop on books*/
    for (var idxBook in bookContent.books) {
        //var bookLangs = bookContent.books[idxBook];
        var order = DEFAULT_ORDER;
        var book = bookContent.books[idxBook];
        if (book.order) order = book.order;
        book.language = config.LANG_DEFAULT;
        var toc = {
            name: bookConfig.name ? bookConfig.name : book.title,
            id: bookConfig.id,
            orderBook: bookConfig.idNb,
            order: bookConfig.order ? bookConfig.order : order,
            children: [],
        };
        var dstDir = path.join(config.DOCS_DIR, book.language, section.version, section.name, config.FETCH_DIR);

        var chapterData = {
            language: book.language,
            toc: toc,
            bookConfig: bookConfig,
            dstDir: dstDir,
            tocsMapLanguage: section.tocsMapLanguage,
            section: section,
            src_prefix: book.src_prefix,
            url_edit: book.url_edit || global.url_edit,
        };

        ReadChapters(book.chapters, chapterData);
        handleTocs(section, bookConfig, book, toc);
    }
    //TOFIX: better to do it only at the end
    GenerateDataTocsAndIndex(section);
}

async function downloadBook(section, bookConfig) {
    if(isPdf(bookConfig.url)) {
        ReadBook(section, bookConfig);
    } else {
        bookConfig.outFile = downloadFile(bookConfig.url, bookConfig.localPath, true);

        bookConfig.outFile.on("finish", function () {
            ReadBook(section, bookConfig);
        });
    }
}

function isPdf(name) {
    return name.endsWith(".pdf");
}

function SetUrl(section, sectionContent, bookConfig) {
    var overloadConfig;
    if(fse.existsSync(config.FETCH_CONFIG_OVERLOAD)) {
        overloadConfig = yaml.load(fse.readFileSync(config.FETCH_CONFIG_OVERLOAD));
    }
    for (var idx2 in overloadConfig) {
        var overload = overloadConfig[idx2];
        if ((bookConfig.git_name && (overload.git_name == bookConfig.git_name)) ||
            (bookConfig.id && (overload.id == bookConfig.id))) {
            bookConfig.url_fetch = path.join(overload.url_fetch, "%source%");
            bookConfig.git_commit = overload.git_commit;
            if(VERBOSE) console.log("overload config for %s", overload.git_name ? overload.git_name : overload.id);
        }
    }

    var url;
    if (!bookConfig.git_commit && !sectionContent.git_commit) {
        bookConfig.git_commit = section.version;
    }
    if (isPdf(bookConfig.path)) {
        bookConfig.path = bookConfig.path.replace("%commit%", (bookConfig.git_commit || sectionContent.git_commit));
        url = bookConfig.path;
    } else {
        url = bookConfig.url_fetch || sectionContent.url_fetch;
        url = url.replace("AGL_GITHUB_FETCH", config.AGL_GITHUB_FETCH);
        url = url.replace("GITHUB_FETCH", config.GITHUB_FETCH);
        url = url.replace("GERRIT_FETCH", config.GERRIT_FETCH);
        url = url.replace("%repo%", bookConfig.git_name);
        url = url.replace("%commit%", (bookConfig.git_commit || sectionContent.git_commit));
        url = url.replace("%source%", bookConfig.path);
        url = url.replace("AGL_GITHUB_BRANCH", config.AGL_GITHUB_BRANCH);
        url = url.replace("GITHUB_BRANCH", config.GITHUB_BRANCH);
        url = url.replace("AGL_GERRIT_BRANCH", config.AGL_GERRIT_BRANCH);
    }
    return url;
}

/*FetchBooks: fetch books from remote repos, reading section_<version>.yml*/
//async function FetchBooks(section, sectionContent, tocsMapLanguage) {
async function FetchBooks(section, sectionContent) {

    /*for each books*/
    for (var idx in sectionContent.books) {
        var bookConfig = sectionContent.books[idx];
        //append books
        if (bookConfig.appendBooks) {
            bookConfig.brother = bookConfig.id;
            var appendsectionContent = Object.assign({}, sectionContent);
            appendsectionContent.books = Object.assign({}, bookConfig.appendBooks);
            appendsectionContent.brother = bookConfig.id;
            FetchBooks(section, appendsectionContent);
            if (!section.brotherBooks[bookConfig.id]) {
                console.error("ERROR: brotherBooks should not empty");
                process.exit(1);
            }
        }
        if (bookConfig.path) {
            if(sectionContent.parent) bookConfig.parent = sectionContent.parent;
            if(bookConfig.books) bookConfig.childBook = true;
            bookConfig.idNb = idx;
            bookConfig.nbBooks = sectionContent.books.length;

            bookConfig.url = SetUrl(section, sectionContent, bookConfig);
            bookConfig.fileName = bookConfig.id + "-" + path.basename(bookConfig.path);
            bookConfig.localPath = path.join(config.DATA_DIR, "tocs", section.name, section.version, bookConfig.fileName);
            if(sectionContent.brother) {
                bookConfig.brother = sectionContent.brother;
                if(!section.brotherBooks[sectionContent.brother]) {
                    section.brotherBooks[sectionContent.brother] = [];
                }
                section.brotherBooks[sectionContent.brother].push(bookConfig);
            }
            downloadBook(section, bookConfig);
        }
        //children books
        if(bookConfig.books) {
            var subsectionContent = Object.assign({}, sectionContent);
            subsectionContent.books = Object.assign({}, bookConfig.books);
            subsectionContent.parent = bookConfig.id;
            FetchBooks(section, subsectionContent, section.tocsMapLanguage);
        }
    }
}

/*not using sort array nodejs function because
 * behavior change with 10 items*/
function sortWithOrder(tab) {
    var sortedTab = [];

    var iterator = tab.keys();
    for (let key of iterator) {
        var entry = tab[key];
        if(entry.children) {
            entry.children = sortWithOrder(entry.children);
        }
        var idx = sortedTab.findIndex(function(newEntry) {
            return newEntry.order > entry.order;
        });
        idx = idx < 0 ? sortedTab.length : idx;
        var tmpSortedTab = sortedTab.slice(idx)
        var sortedTab = sortedTab.slice(0, idx);
        sortedTab.push(entry);
        sortedTab = sortedTab.concat(tmpSortedTab);;
    }
    return sortedTab;
}

async function GenerateDataTocsAndIndex(section) {
    /*generated _toc_<version>_<language>.yml and index.html for each {version, language}*/
    section.tocsMapLanguage.forEach(function (unsortedValue, key, map) {
        var value = sortWithOrder(unsortedValue);
        var output = yaml.dump(value, { indent: 4 });
        var destTocName = helpers.genTocfileName(key, section.version);
        var tocsPath = path.join(config.DATA_DIR, "tocs", section.name, destTocName);
        if (!fse.existsSync(tocsPath)) fse.mkdirsSync(path.dirname(tocsPath));
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
        var sectionContent = yaml.load(fse.readFileSync(section.file));
    } catch (error) {
        console.error("ERROR: reading [%s] error=[%s]", section.file, error);
        process.exit(1);
    }
    section.title = sectionContent.name;

    FetchBooks(section, sectionContent);
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
        var sectionConfArray;
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
                brotherBooks: new Map(),
            };
            ParseSection(argv, section);
        }
    }
}

module.exports = main;
