// ==UserScript==
// @name         Traneptora's Roll20 Cleanup Script
// @namespace    https://traneptora.com/
// @version      2025.04.05.3
// @updateURL    https://raw.githubusercontent.com/Traneptora/roll20-cleanup/refs/heads/dist/traneptora-roll20-fixes.meta.js
// @downloadURL  https://raw.githubusercontent.com/Traneptora/roll20-cleanup/refs/heads/dist/traneptora-roll20-fixes.user.js
// @description  Traneptora's Roll20 Cleanup Script
// @author       Traneptora

// @match        https://app.roll20.net/editor
// @match        https://app.roll20.net/editor#*
// @match        https://app.roll20.net/editor?*
// @match        https://app.roll20.net/editor/
// @match        https://app.roll20.net/editor/#*
// @match        https://app.roll20.net/editor/?*

// @run-at       context-menu

// @grant        none
// ==/UserScript==
(async () => {
    const d20 = window.d20 || window.currentPlayer.d20;
    const $ = window.$;
    const permit_thorough = true;
    const show_info = async (title, message) => {
        const $dialog = $(`<div class="dialog">${message}</div>`);
        return new Promise((resolve, reject) => {
            $dialog.dialog({
                "modal": true,
                "title": title,
                "buttons": {
                    "OK": () => {
                        $dialog.dialog("destroy").remove();
                        resolve();
                    }
                },
                "close": reject,
            });
        });
    }
    const open_sheet = async (model, hidden) => {
        console.log(`Loading sheet: ${model.attributes.name}`);
        const cssrule = `div:has(div.characterdialog[data-characterid="${model.id}"]) { display: none !important; }`;
        const styleSheet = document.styleSheets[0];
        const ruleList = styleSheet.cssRules;
        const idx = hidden ? styleSheet.insertRule(cssrule) : 0;
        const close_sheet = async () => {
            model.view.remove();
            if (!hidden) {
                return;
            }
            if (ruleList[idx].cssText === cssrule) {
                styleSheet.deleteRule(idx);
                return;
            }
            for (let i = 0; i < ruleList.length; i++) {
                if (ruleList[i].cssText === cssrule) {
                    styleSheet.deleteRule(i);
                    return;
                }
            }
            return Promise.reject(`Couldn't find rule that was inserted for model: ${model.id}`);
        };
        document.querySelector(`li[data-itemid="${model.id}"]`).click();
        return new Promise((resolve, reject) => {
            let mancer_count = 0;
            let count = 0;
            const wait_open = () => {
                if (count++ >= 20) {
                    model.view.remove();
                    reject(`Timed out on loading page view for model: ${model.id}`);
                    return;
                }
                const fec = model.view.el.firstElementChild;
                const doc = fec?.contentDocument || fec?.contentWindow?.document;
                if (!doc?.querySelector(".charactersheet")) {
                    setTimeout(wait_open, 100);
                    return;
                }
                const mancer = doc.querySelector(".mancer_confirm input[name=attr_mancer_cancel]");
                if (!mancer && mancer_count++ < 2) {
                    setTimeout(wait_open, 100);
                    return;
                }
                if (mancer) {
                    mancer.click();
                }
                resolve(close_sheet);
            };
            wait_open();
        });
    };
    const detect_bad_token_default = async (model) => {
        return model.getDefaultToken().then((token) => {
            if (token.represents === model.id) {
                return { "correct": true, "found": true };
            }
            if (!token.represents) {
                return { "correct": true, "found": false };
            }
            const repr = d20.journal.findJournalItem(token.represents);
            return { "correct": false, "found": !!repr, "repr": repr};
        });
    };
    const detect_sheet_removal_issue = (model) => {
        if (!model.attributes.ownedBy) {
            return { "owned": false, "api_id": null };
        }
        const parts = model.id.toString().split("_", 2);
        /* undefined instead of null because isFinite(null) == true */
        const api_id = parts.length == 2 ? +parts[1] : undefined;
        if (isFinite(api_id)) {
            return {"owned": true, "api_id": parts[1]};
        }
        return {"owned": true, "api_id": null };
    };
    const check_bad_whisper = (model) => {
        if (!model.attribs.models.length) {
            return { "badwhisper": null };
        }
        const rtype = model.attribs.models.find(m => m.attributes.name === "rtype");
        const wtype = model.attribs.models.find(m => m.attributes.name === "wtype");
        return {
            "badwhisper": rtype?.attributes.current === "@{advantagetoggle}"
                       && wtype?.attributes.current.trim() === "",
            "wtype": wtype,
            "rtype": rtype,
        };
    };
    const safe_fix_incorrect_token = async (scan) => {
        return new Promise((resolve, reject) => {
            const tscan = scan.tscan;
            if (tscan.correct || !tscan.found) {
                resolve({ "match": false });
                return;
            }
            const $dialog = $(`<div class="dialog">Found an issue with sheet: ${scan.model.attributes.name}.<br>Its default token is pointing to a different sheet: ${tscan.repr.attributes.name}.<br>Would you like this to be fixed?</div>`);
            $dialog.dialog({
                "modal": true,
                "title": "Fix this issue?",
                "buttons": {
                    "No, do nothing.": () => {
                        $dialog.dialog("destroy").remove();
                        resolve({ "match": true, "fix": false });
                    },
                    "Yes, please fix.": () => {
                        $dialog.dialog("destroy").remove();
                        scan.model.getDefaultToken().then((token) => {
                            token.represents = scan.model.id;
                            scan.model.saveDefaultToken(token);
                            resolve({ "match": true, "fix": true });
                        });
                    }
                },
                "close": () => {
                    resolve({ "match": true, "fix": false });
                }
            });
        });
    };
    const safe_fix_unremovable_sheet = async (scan) => {
        return new Promise((resolve, reject) => {
            const rscan = scan.rscan;
            if (!rscan.owned || rscan.api_id) {
                resolve({ "match": false });
                return;
            }
            const $dialog = $(`<div class"dialog">Found a linked sheet that you probably can't get rid of: ${scan.model.attributes.name}.<br>Would you like it to be deleted?"`);
            $dialog.dialog({
                "modal": true,
                "title": "Confirm Deletion",
                "buttons": {
                    "No, do nothing.": () => {
                        $dialog.dialog("destroy").remove();
                        resolve({ "match": true, "fix": false });
                    },
                    "Yes, please delete.": () => {
                        $dialog.dialog("destroy").remove();
                        scan.model.attributes.ownedBy = undefined;
                        scan.model.destroy();
                        resolve({ "match": true, "fix": true });
                    }
                },
                "close": () => {
                    resolve({ "match": true, "fix": false });
                }
            });
        });
    };
    const safe_fix_bad_whisper = async (scan) => {
        const wscan = scan.wscan;
        if (!wscan.badwhisper) {
            return {"match": false};
        }
        const selectbox = scan.model.view.el?.firstElementChild?.contentDocument
            ?.querySelector(".is-npc select[name=attr_wtype]");
        if (selectbox) {
            console.log(`Enabling Whisper Toggle For: ${scan.model.attributes.name}`);
            selectbox.value = "@{whispertoggle}";
            await scan.model.view.saveSheetValues(selectbox);
        }
        return { "match": true, "fixed": !!selectbox };
    };
    const detect_sheet_name_collisions = (scan, name) => {
        if (!name) {
            name = scan.model.attributes.name;
        }
        const collisions = scan.data.chars.filter(c => c.attributes.name === name && c.id !== scan.model.id);
        return { "unique": !collisions.length, "models": collisions };
    };
    const rename_sheet_from_collision = (scan) => {
        let counter = 0;
        const basename = scan.model.attributes.name + " ";
        let name;
        do {
            name = basename + (++counter).toString(16).toUpperCase();
        } while (!detect_sheet_name_collisions(scan, name).unique);
        scan.model.save({ "name": name });
    };
    const safe_fix_sheet_collision = async (scan) => {
        return new Promise((resolve, reject) => {
            const cscan = scan.cscan;
            if (cscan.unique) {
                resolve({ "match": false });
                return;
            }
            const $dialog = $(`<div class="dialog">Found at least two sheets with the same name: ${scan.model.attributes.name}.<br>This sometimes causes problems. Would you like to rename this one?`);
            $dialog.dialog({
                "modal": true,
                "title": "Confirm Rename",
                "buttons": {
                    "No, do nothing.": () => {
                        $dialog.dialog("destroy").remove();
                        resolve({ "match": true, "fix": false });
                    },
                    "Yes, please rename.": () => {
                        $dialog.dialog("destroy").remove();
                        rename_sheet_from_collision(scan);
                        resolve({ "match": true, "fix": true });
                    }
                },
                "close": () => {
                    resolve({ "match": true, "fix": false });
                }
            });
        });
    };
    const scan_model = async (model, data) => {
        let all_clear = true;
        const scan = {"model": model, "data": data};
        scan.rscan = detect_sheet_removal_issue(model);
        const rfix = await safe_fix_unremovable_sheet(scan);
        if (rfix.match && rfix.fix) {
            return { "all_clear": false, "later": false };
        }
        scan.cscan = detect_sheet_name_collisions(scan);
        const cfix = await safe_fix_sheet_collision(scan);
        if (cfix.match && cfix.fix) {
            all_clear = false;
        }
        scan.tscan = await detect_bad_token_default(model);
        const tfix = await safe_fix_incorrect_token(scan);
        if (tfix.match && tfix.fix) {
            all_clear = false;
        }
        scan.wscan = check_bad_whisper(model);
        let close_callback = null;
        if (scan.wscan.badwhisper === null && data.thorough) {
            close_callback = await open_sheet(model, true)
                .catch((err) => { console.log(err); return null; } );
            if (close_callback) {
                scan.wscan = check_bad_whisper(model);
            }
        }
        const wfix = await safe_fix_bad_whisper(scan);
        if (wfix.match && wfix.fixed) {
            all_clear = false;
        }
        if (close_callback) {
            await close_callback().catch((err) => { console.log(err); return null; });
        }
        return { "all_clear": all_clear, "later": false };
    };
    const perform_scan = async (thorough) => {
        let all_clear = true;
        const chars = d20.Campaign.activeCharacters();
        chars.sort();
        const data = { "thorough": thorough, "chars": chars };
        for (const model of chars) {
            const result = await scan_model(model, data)
                .catch((err) => { console.log(err); return null; });
            all_clear = result && result.all_clear && all_clear;
        }
        return all_clear;
    };
    const scan_type_query = async () => {
        if (!window.is_gm) {
            const message = "You must be a GM in the game room to run this script.";
            await show_info("Must be GM", message);
            return Promise.reject(message);
        }
        if (!permit_thorough) {
            await show_info("Performing Scan", "Performing a quick scan.");
            return "fast";
        }
        return new Promise((resolve, reject) => {
            const $dialog = $(`<div class="dialog">I can conduct a fast scan, or I can conduct a thorough scan. A fast scan can be performed very quickly. A thorough scan requires this script to load every sheet, but it can detect more issues. Which would you prefer?`);
            $dialog.dialog({
                "modal": true,
                "title": "Choose Scan Type",
                "buttons": {
                    "Fast Scan": () => {
                        $dialog.dialog("destroy").remove();
                        resolve("fast");
                    },
                    "Thorough Scan": () => {
                        $dialog.dialog("destroy").remove();
                        resolve("thorough");
                    }
                },
                "close": () => {
                    reject("closed");
                }
            });
        });
    };
    return scan_type_query().catch((err) => {
        console.log("Scan type query closed, doing nothing.");
        return Promise.reject(err);
    }).then((type) => {
        if (type === "fast") {
            return perform_scan(false);
        } else if (type === "thorough") {
            return perform_scan(true);
        }
    }).then((result) => {
        if (result) {
            return show_info("All Clear", "No sheet issues were found.");
        } else {
            return show_info("Scan completed.", "Scan completed.")
        }
    });
})();
