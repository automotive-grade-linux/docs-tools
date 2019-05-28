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

var crawler    = require("simplecrawler");

function main (config, argv) {

    var uri;

    if (argv.prod) uri=config.CRAWL_PROD;
    else uri=uri=config.CRAWL_DEV;

    if (!uri) {
        console.log ("ERROR: CRAWL_DEV/PROD not defined in AppConfig.js");
        process.exit(1);
    }

    var nb404 = 0;
    var nbFetchErr = 0;
    crawler
        .crawl(uri)
        .on("fetch404", function(queueItem, response) {
            // Ignore local javascript files
            if (String(queueItem.path).startsWith('/static/js') || String(queueItem.path).startsWith('/static/img')) {
                return;
            }

            console.log("Error %s: from %s to %s", response.statusCode, queueItem.referrer, queueItem.path);
            nb404 += 1;
        })
        .on("fetchclienterror", function(queueItem) {
            if (argv.verbose) console.log("Error fetch: url=%s, referrer=%s", queueItem.url, queueItem.referrer);
            nbFetchErr += 1;
            //process.exit (1);
        })
        .on("complete", function(queueItem) {
           if (argv.verbose) console.log ("\n\nCrawler done");
           if (nb404 != 0) console.log("  %d not found errors (aka 404) detected !", nb404);
           if (nbFetchErr != 0) console.log("  %d fetch errors detected !", nbFetchErr);
           if (nb404 != 0 || nbFetchErr != 0) {
               process.exit(1);
           }
        });
}

module.exports = main;
