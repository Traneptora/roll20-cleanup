(async () => {
    const d20 = window.d20 || window.currentPlayer.d20;
    const $ = window.$;
    const permit_thorough = true;
    const log_error = (err) => {
        console.log(err);
        return null;
    };
    const show_info = (title, message) => {
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
    const show_confirm_dialog = (title, messages, options) => {
        return new Promise((resolve, reject) => {
            let dialog_html = '<div class="dialog">';
            let first = true;
            for (const message of messages) {
                if (!first) {
                    dialog_html += '<br><br>';
                }
                if (typeof message === "object" && message.key) {
                    dialog_html += `<b>${message.key}:</b><br>${message.value}`;
                } else {
                    dialog_html += message;
                }
                first = false;
            }
            dialog_html += '</div>';
            const $dialog = $(dialog_html);
            const buttons = {};
            for (const opt of options) {
                buttons[opt.key] = () => {
                    $dialog.dialog("destroy").remove();
                    Promise.resolve(opt.func()).then(() => {
                        resolve({ "match": true, "fix": opt.fix });
                    });
                };
            }
            $dialog.dialog({
                "modal": true,
                "title": title,
                "buttons": buttons,
                "close": () => {
                    resolve({ "match": true, "fix": false });
                }
            });
        });
    };
    const get_document = (model) => {
        const fec = model.view.el?.firstElementChild;
        return fec?.contentDocument || fec?.contentWindow?.document;
    };
    const open_sheet = (model, hidden) => {
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
                const doc = get_document(model);
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
    const detect_bad_token_default = (model) => {
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
            return { "owned": true, "api_id": parts[1] };
        }
        return {"owned": true, "api_id": null };
    };
    const check_bad_whisper = (model) => {
        if (!model.attribs.models.length) {
            return { "badwhisper": null };
        }
        const rtype = get_attribute(model, "rtype");
        const wtype = get_attribute(model, "wtype");
        return {
            "badwhisper": rtype === "@{advantagetoggle}" && wtype?.trim() === "",
            "wtype": wtype,
            "rtype": rtype,
        };
    };
    const safe_fix_incorrect_token = (scan) => {
        const tscan = scan.tscan;
        if (tscan.correct || !tscan.found) {
            return { "match": false };
        }
        return show_confirm_dialog("Fix this issue?", [
            {
                "key": "Found an issue with sheet",
                "value": scan.model.attributes.name,
            },
            {
                "key": "Its default token is pointing to a different sheet",
                "value": tscan.repr.attributes.name,
            },
            "Would you like this to be fixed?",
        ], [
            {
                "key": "No, do nothing.",
                "fix": false,
                "func": () => {},
            },
            {
                "key": "Yes, please fix.",
                "fix": true,
                "func": () => {
                    return scan.model.getDefaultToken().then((token) => {
                        token.represents = scan.model.id;
                        scan.model.saveDefaultToken(token);
                    });
                },
            },
        ]);
    };
    const safe_fix_unremovable_sheet = (scan) => {
        const rscan = scan.rscan;
        if (!rscan.owned || rscan.api_id) {
            return { "match": false };
        }
        return show_confirm_dialog("Confirm Deletion", [
            {
                "key": "Found a linked sheet that you probably can't get rid of",
                "value": scan.model.attributes.name,
            },
            "Would you like it to be deleted?",
        ], [
            {
                "key": "No, do nothing.",
                "fix": false,
                "func": () => {},
            },
            {
                "key": "Yes, please delete.",
                "fix": true,
                "func": () => {
                    scan.model.attributes.ownedBy = undefined;
                    scan.model.destroy();
                },
            },
        ]);
    };
    const safe_fix_bad_whisper = async (scan) => {
        const wscan = scan.wscan;
        if (!wscan.badwhisper) {
            return { "match": false };
        }
        const selectbox = get_document(scan.model)?.querySelector(".is-npc select[name=attr_wtype]");
        if (selectbox) {
            console.log(`Enabling Whisper Toggle For: ${scan.model.attributes.name}`);
            selectbox.value = "@{whispertoggle}";
            await scan.model.view.saveSheetValues(selectbox);
        }
        return { "match": true, "fix": !!selectbox };
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
    const safe_fix_sheet_collision = (scan) => {
        const cscan = scan.cscan;
        if (cscan.unique) {
            return { "match": false };
        }
        return show_confirm_dialog("Confirm Rename", [
            {
                "key": "Found at least two sheets with the same name",
                "value": scan.model.attributes.name,
            },
            "This sometimes causes problems. Would you like to rename this one?",
        ], [
            {
                "key": "No, do nothing.",
                "fix": false,
                "func": () => {},
            },
            {
                "key": "Yes, please rename.",
                "fix": true,
                "func": () => {
                    rename_sheet_from_collision(scan);
                },
            },
        ]);
    };
    const get_attribute = (model, name) => {
        const attr = model.attribs.models.filter(m => m.attributes.name === name);
        return attr.length > 0 ? attr[0].attributes.current : null;
    };
    const scan_sheetvalues = (model) => {
        if (!model.attribs.models.length) {
            return { "issue": null };
        }
        const vscan = {};
        vscan.type = get_attribute(model, "charactersheet_type");
        vscan.issue = false;
        if (vscan.type === "npc") {
            vscan.crstr = get_attribute(model, "npc_challenge")?.trim() || "NaN";
            const fracsplit = vscan.crstr.split("/", 2);
            if (+fracsplit[0] >= 0 && +fracsplit[1] > 0) {
                vscan.cr = +fracsplit[0] / +fracsplit[1];
            } else {
                vscan.cr = +vscan.crstr;
            }
            vscan.pb = +get_attribute(model, "npc_pb");
            vscan.fix_npc_pb = vscan.pb === 0 && vscan.cr >= 0;
            vscan.issue = vscan.fix_npc_pb || vscan.issue;
        } else if (vscan.type === "pc") {
            vscan.pb = +get_attribute(model, "pb");
        }
        return vscan;
    };
    const safe_fix_sheetvalues = async (scan) => {
        const vscan = scan.vscan;
        if (!vscan.issue) {
            return { "match": false };
        }
        let p = Promise.resolve({ "match": true, "fix": false });
        const yestoall = scan.data.yestoall;
        if (vscan.fix_npc_pb) {
            const correct_pb = 2 + Math.trunc((vscan.cr - 1) / 4.0);
            const fix = async () => {
                console.log(`Setting PB to ${correct_pb} for: ${scan.model.attributes.name}`);
                const pb_input = get_document(scan.model)
                    ?.querySelector(".is-npc input[name=attr_npc_pb]");
                if (pb_input) {
                    pb_input.value = correct_pb;
                    await scan.model.view.saveSheetValues(pb_input);
                }
            };
            if (yestoall.npc_pb === true) {
                p = p.then(fix).then(() => ({ "match": true, "fix": true }));
            } else {
                p = p.then(async (prev) => {
                    const barray = [
                        {
                            "key": "No, do nothing.",
                            "fix": false,
                            "func": () => {},
                        },
                        {
                            "key": "Yes, please fix.",
                            "fix": true,
                            "func": () => {
                                if (yestoall.npc_pb === undefined) {
                                    yestoall.npc_pb = false;
                                }
                                return fix();
                            },
                        },
                    ];
                    if (yestoall.npc_pb === false) {
                        barray.push({
                            "key": "Yes, please fix ALL such issues.",
                            "fix": true,
                            "func": () => {
                                yestoall.npc_pb = true;
                                return fix();
                            },
                        });
                    }
                    const v = await show_confirm_dialog("Fix Sheet PB?", [
                        {
                            "key": "This NPC sheet has its PB set to 0",
                            "value": scan.model.attributes.name,
                        },
                        {
                            "key": "Its Challlenge Rating is",
                            "value": vscan.crstr,
                        },
                        {
                            "key": "Its Proficiency Bonus <em>should</em> be",
                            "value": correct_pb.toString(),
                        },
                        "Would you like me to fix its PB?",
                    ], barray);
                    prev.fix = v.fix || prev.fix;
                    return prev;
                });
            }
        }
        return p;
    };
    const scan_model = async (model, data) => {
        let all_clear = true;
        const scan = {"model": model, "data": data};
        scan.rscan = detect_sheet_removal_issue(model);
        const rfix = await safe_fix_unremovable_sheet(scan);
        if (rfix.fix) {
            return { "all_clear": false, "later": false };
        }
        if (rfix.match) {
            all_clear = false;
        }
        scan.cscan = detect_sheet_name_collisions(scan);
        const cfix = await safe_fix_sheet_collision(scan);
        if (cfix.match) {
            all_clear = false;
        }
        scan.tscan = await detect_bad_token_default(model);
        const tfix = await safe_fix_incorrect_token(scan);
        if (tfix.match) {
            all_clear = false;
        }
        scan.wscan = check_bad_whisper(model);
        let close_callback = null;
        if (scan.wscan.badwhisper === null && data.thorough) {
            close_callback = await open_sheet(model, true).catch(log_error);
            if (close_callback) {
                scan.wscan = check_bad_whisper(model);
            }
        }
        const wfix = await safe_fix_bad_whisper(scan);
        if (wfix.match) {
            all_clear = false;
        }
        scan.vscan = scan_sheetvalues(model);
        if (scan.vscan.issue === null && data.thorough) {
            if (!close_callback) {
                close_callback = await open_sheet(model, true).catch(log_error);
            }
            if (close_callback) {
                scan.vscan = scan_sheetvalues(model);
            }
        }
        const vfix = await safe_fix_sheetvalues(scan);
        if (vfix.match) {
            all_clear = false;
        }
        if (close_callback) {
            await close_callback().catch(log_error);
        }
        return { "all_clear": all_clear, "later": false };
    };
    const perform_scan = async (thorough) => {
        let all_clear = true;
        const chars = d20.Campaign.activeCharacters();
        chars.sort();
        const data = { "thorough": thorough, "chars": chars, "yestoall": {} };
        for (const model of chars) {
            const result = await scan_model(model, data).catch(log_error);
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
