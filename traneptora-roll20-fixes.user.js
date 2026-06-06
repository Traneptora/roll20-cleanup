// ==UserScript==
// @name         Traneptora's Roll20 Cleanup Script
// @namespace    https://traneptora.com/
// @version      2026.06.06.3
// @updateURL    https://raw.githubusercontent.com/Traneptora/roll20-cleanup/refs/heads/dist/traneptora-roll20-fixes.meta.js
// @downloadURL  https://raw.githubusercontent.com/Traneptora/roll20-cleanup/refs/heads/dist/traneptora-roll20-fixes.user.js
// @description  Traneptora's Roll20 Cleanup Script
// @author       Traneptora
// @icon         https://traneptora.com/images/avatar/128.png?v=3

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
    const timeout = (ms) => {
        return new Promise((resolve, reject) => setTimeout(resolve, ms));
    };
    let tries = 30;
    while (tries-- > 0 && !window.d20 && !window.currentPlayer?.d20) {
        console.log("Trying to load d20...");
        await timeout(500);
    }
    if (!tries) {
        console.log("Timed out loading d20.");
        return Promise.reject("Timed out loading d20.");
    }

    const d20 = window.d20 || window.currentPlayer.d20;
    const $ = window.$;
    const permit_thorough = true;

    const tranep20 = window.tranep20 || {};
    window.tranep20 = tranep20;

    const log_error = (err) => {
        console.log(err);
        return null;
    };

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
    };

    const show_confirm_dialog = (title, messages, options) => {
        return new Promise((resolve, reject) => {
            let dialog_html = '<div class="dialog">';
            let first = true;
            for (const message of messages) {
                if (!first) {
                    dialog_html += '<br><br>';
                }
                if (typeof message === "object" && message?.key) {
                    dialog_html += `<b>${message.key}:</b><br>${message.value}`;
                } else {
                    dialog_html += message;
                }
                first = false;
            }
            dialog_html += '</div>';
            const $dialog = $(dialog_html);
            const buttons = {};
            options = [
                {
                    "key": "No, do nothing.",
                    "fix": false,
                    "func": () => {},
                },
            ].concat(options);
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
        model = lookup_sheet(model);
        const fec = model.view.el?.firstElementChild;
        return fec?.contentDocument || fec?.contentWindow?.document;
    };

    const is_ogl5e = (model) => {
        model = lookup_sheet(model);
        return model?.attributes?.charactersheetname === "ogl5e" || model?.characterSheet?.shortName === "ogl5e";
    };

    const close_sheet = (model) => {
        model = lookup_sheet(model);
        if (!is_ogl5e(model)) {
            return Promise.reject(`Refusing to open non ogl5e sheet: ${model.id}`);
        }
        const cssrule = `div:has(div.characterdialog[data-characterid="${model.id}"]) { display: none !important; }`;
        const styleSheet = document.styleSheets[0];
        const ruleList = styleSheet.cssRules;
        const close_button = document.querySelector(
                `div:has(a.ui-dialog-titlebar-close):has(div[data-characterid="${model.id}"])`
                + ' a.ui-dialog-titlebar-close');
        if (!close_button) {
            return Promise.reject(`Couldn't find close button for model: ${model.id}`);
        }
        close_button.click();
        for (let i = 0; i < ruleList.length; i++) {
            if (ruleList[i].cssText === cssrule) {
                styleSheet.deleteRule(i);
                return Promise.resolve();
            }
        }
        return Promise.resolve();
    };

    const open_sheet = (model, hidden) => {
        model = lookup_sheet(model);
        console.log(`Loading sheet: ${model.attributes.name}`);
        if (!is_ogl5e(model)) {
            return Promise.reject(`Refusing to open non ogl5e sheet: ${model.id}`);
        }
        if (hidden) {
            const cssrule =
                `div:has(div.characterdialog[data-characterid="${model.id}"]) { display: none !important; }`;
            const styleSheet = document.styleSheets[0];
            styleSheet.insertRule(cssrule);
        }
        return new Promise((resolve, reject) => {
            let mancer_count = 0;
            let count = 40;
            let clicked = false;
            const wait_open = () => {
                if (count-- <= 0) {
                    close_sheet(model);
                    reject(`Timed out on loading page view for model: ${model.id}`);
                    return;
                }
                const li = document.querySelector(`li[data-itemid="${model.id}"]`);
                if (!li) {
                    setTimeout(wait_open, 100);
                    return;
                }
                if (!clicked) {
                    li.click();
                    clicked = true;
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
                const gear = doc.querySelector('.container.npc input[name="attr_npc_options-flag"]')
                    || doc.querySelector('.container.pc input.options[name="attr_tab"]');
                if (!gear) {
                    setTimeout(wait_open, 100);
                    return;
                }
                setTimeout(() => resolve(true), 200);
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
        if (model.attributes.account_id && model.attributes.vault_character_id && model.attributes.ownedBy) {
            return { "owned": true, "owner": model.attributes.ownedBy, "creator": model.attributes.createdBy };
        }
        return { "owned": false, "owner": null, "creator": model.attributes.createdBy };
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

    const uniqof = (arr) => {
        return arr && arr.length ? arr[0] : null;
    };

    const get_model_for_name = (name) => {
        const chars = d20.Campaign.activeCharacters();
        chars.sort();
        return uniqof(chars.filter(c => c.attributes.name === name));
    };

    const lookup_sheet = (input) => {
        if (typeof(input) !== "string") {
            return input;
        }
        const by_id = d20.journal.findJournalItem(input);
        if (by_id) {
            return by_id;
        }
        return get_model_for_name(input);
    };

    const duplicate_sheet = async (model) => {
        model = lookup_sheet(model);
        const success = await open_sheet(model, true).catch(log_error);
        await close_sheet(model);
        if (!success) {
            return null;
        }
        const orig = model.toJSON();
        delete orig.id;
        orig.ownedBy = "";
        orig.account_id = null;
        const dupe = model.collection.create(orig);
        await timeout(200);
        let attrorder = dupe.get("attrorder");
        const tok = await model.getDefaultToken();
        model.attribs.each((a) => {
            const j = a.toJSON();
            delete j.id;
            const a2 = dupe.attribs.create(j);
            if (tok?.bar1_link === a.id) {
                tok.bar1_link = a2.id;
            }
            if (tok?.bar2_link === a.id) {
                tok.bar2_link = a2.id;
            }
            if (tok?.bar3_link === a.id) {
                tok.bar3_link = a2.id;
            }
            attrorder = attrorder.replace(a.id, a2.id);
        });
        let abilorder = dupe.get("abilorder");
        model.abilities.each((a) => {
            const j = a.toJSON();
            delete j.id;
            const a2 = dupe.abilities.create(j);
            abilorder = abilorder.replace(a.id, a2.id);
        });
        dupe.save({ "abilorder": abilorder, "attrorder": attrorder });
        const blobs = {};
        if (model._blobcache.bio) {
            blobs.bio = model._blobcache.bio;
        }
        if (model._blobcache.gmnotes) {
            blobs.gmnotes = model._blobcache.gmnotes;
        }
        await dupe.updateBlobs(blobs);
        if (tok) {
            tok.represents = dupe.id;
            await dupe.saveDefaultToken(tok);
        }
        const dig = (arr) => {
            for (let idx = 0; idx < arr.length; idx++) {
                if (arr[idx] === model.id) {
                    arr.splice(idx, 0, dupe.id);
                    return true;
                }
                if (typeof arr[idx] === "object" && Array.isArray(arr[idx]?.i)) {
                    if (dig(arr[idx].i)) {
                        return true;
                    }
                }
            }
            return false;
        };
        let jf = d20.Campaign.get("journalfolder");
        if (jf !== "") {
            jf = JSON.parse(jf);
            if (Array.isArray(jf)) {
                dig(jf);
                jf = JSON.stringify(jf);
                d20.Campaign.save({ "journalfolder": jf });
            }
        }
        const scan = { "model": dupe, "data": { "chars" : await d20.Campaign.activeCharacters() } };
        rename_sheet_from_collision(scan);
        await tranep20.fix_duped_spells(dupe.id);
        await tranep20.fix_spell_dcs(dupe.id);
        return d20.journal.findJournalItem(dupe.id);
    };

    const destroy_character = async (model, force) => {
        const id = model.id;
        if (model.isLinkedCharacter()) {
            model.unlinkFromGame();
            await timeout(500);
            if (!force && !d20.journal.findJournalItem(id)) {
                return;
            }
        }
        model.destroy();
    };

    const safe_fix_unremovable_sheet = (scan) => {
        const rscan = scan.rscan;
        if (!rscan.owned) {
            return { "match": false };
        }
        if (!rscan.owner || rscan.owner !== rscan.creator) {
            return { "match": false };
        }
        return show_confirm_dialog("Confirm Deletion", [
            {
                "key": "Found a linked sheet.",
                "value": scan.model.attributes.name,
            },
            "Would you like me to do anything about it?",
        ], [
            {
                "key": "Yes, remove it.",
                "fix": true,
                "func": async () => {
                    return destroy_character(scan.model, false);
                },
            },
            {
                "key": "Yes, unlink it.",
                "fix": true,
                "func": async () => {
                    const name = scan.model.attributes.name;
                    const dupe = await duplicate_sheet(scan.model);
                    if (dupe) {
                        return destroy_character(scan.model, false).then(() => dupe.save({"name": name}));
                    }
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
                "key": "Yes, please rename.",
                "fix": true,
                "func": () => rename_sheet_from_collision(scan),
            },
        ]);
    };

    const get_attribute = (model, name) => {
        return uniqof(model.attribs.filter(m => m.attributes.name === name))?.attributes?.current;
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
                    return scan.model.view.saveSheetValues(pb_input);
                }
            };
            if (yestoall.npc_pb === true) {
                p = p.then(fix).then(() => ({ "match": true, "fix": true }));
            } else {
                p = p.then(async (prev) => {
                    const barray = [
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
        if (data.thorough) {
            const success = await open_sheet(model, false).catch(log_error);
            if (success) {
                scan.wscan = check_bad_whisper(model);
                scan.vscan = scan_sheetvalues(model);
                const wfix = await safe_fix_bad_whisper(scan);
                const vfix = await safe_fix_sheetvalues(scan);
                if (wfix.match || vfix.match) {
                    all_clear = false;
                }
                await timeout(200);
            }
            await close_sheet(model).catch(log_error);
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
                "close": () => reject("closed"),
            });
        });
    };

    const run_scan = async () => {
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
    };

    const fix_spell_dcs = async (input) => {
        const model = lookup_sheet(input);
        if (!await open_sheet(model, false)) {
            return Promise.reject("Could not open sheet.");
        }
        const bdoc = get_document(model);
        const re = /^repeating_spell-([0-9a-zA-Z]+)_([^_]+)_spell_ability$/;
        const spelms = model.attribs.filter(m => m?.attributes?.name?.match(re))
            .map(m => m.attributes.name.replace(re, "$2"));
        const prev = {};
        for (const id of spelms) {
            const field = bdoc.querySelector('div[data-reprowid="' + id + '"] select[name="attr_spell_ability"]');
            prev[id] = field.value;
            if (field.value === "spell") {
                field.value = "0*";
            } else {
                field.value = "spell";
            }
            await model.view.saveSheetValues(field);
        }
        for (const id of spelms) {
            const field = bdoc.querySelector('div[data-reprowid="' + id + '"] select[name="attr_spell_ability"]');
            field.value = prev[id];
            await model.view.saveSheetValues(field);
        }
        await close_sheet(model);
    };

    /* convert a NodeList to an Array */
    const nta = n => Array.prototype.map.call(n, k => k);

    const fix_duped_spells = async (input) => {
        const model = lookup_sheet(input);
        if (!await open_sheet(model, false)) {
            return Promise.reject("Could not open sheet.");
        }
        const bdoc = get_document(model);
        const all_spelms = nta(bdoc.querySelectorAll('div.spell-container div[data-reprowid]'));
        const all_spelm_ids = all_spelms.map(s => s.dataset.reprowid);
        const spelm_lookup = {};
        for (const spelm of all_spelm_ids) {
            spelm_lookup[spelm.toLowerCase()] = spelm;
        }
        const atks = bdoc.querySelector('div[data-groupname="repeating_attack"]');
        const spelm_atks = nta(atks.querySelectorAll('div:has(input[name=attr_spellid][value])'));
        const found = [];
        bdoc.querySelector('div.repcontrol[data-groupname="repeating_attack"] .btn.repcontrol_edit').click();
        for (const atk of spelm_atks) {
            const spelm = atk.querySelector('input[name=attr_spellid]').value;
            const l = spelm.toLowerCase();
            if (!(l in spelm_lookup)) {
                continue;
            }
            if (found.includes(l)) {
                atk.querySelector('div.itemcontrol .btn.repcontrol_del').click();
            } else {
                const re = /^repeating_spell-([0-9a-zA-Z]+)_([^_]+)_rollcontent$/;
                const found = model.attribs.filter(m => m?.attributes?.name?.match(re))
                    .filter(m => m.attributes.name.replace(re, "$2").toLowerCase() === l);
                uniqof(found)?.save({
                    "current": '%{' + model.id + '|repeating_attack_' + atk.dataset.reprowid + '_attack}'
                });
            }
            found.push(l);
        }
        bdoc.querySelector('div.repcontrol[data-groupname="repeating_attack"] .btn.repcontrol_edit').click();
    };

    const set_remote_token = async (input, url) => {
        const model = lookup_sheet(input);
        model.save({"avatar": url});
        return model.getDefaultToken().then((tok) => {
            tok.imgsrc = url;
            return model.saveDefaultToken(tok);
        });
    };

    tranep20.lookup_sheet = lookup_sheet;
    tranep20.open_sheet = open_sheet;
    tranep20.duplicate_sheet = duplicate_sheet;
    tranep20.set_remote_token = set_remote_token;
    tranep20.run_scan = run_scan;
    tranep20.fix_spell_dcs = fix_spell_dcs;
    tranep20.close_sheet = close_sheet;
    tranep20.fix_duped_spells = fix_duped_spells;

    window.d20 = d20;

    return run_scan();
})();
