/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import moment from "moment";

import { show_modal_dialog } from "./cockpit-components-dialog.jsx";

let _ = cockpit.gettext;

moment.locale(cockpit.language);

export function detect() {
    return cockpit.spawn([ "which", "insights-client" ], { err: "ignore" }).then(() => true, () => false);
}

export function register() {
    return cockpit.spawn([ "insights-client", "--register" ], { superuser: true, err: "message" });
}

export function unregister() {
    return cockpit.spawn([ "insights-client", "--unregister" ], { superuser: true, err: "message" });
}

function show_register_dialog() {
    show_modal_dialog(
        {
            title: _("Register to Red Hat Insights"),
            body: (
                <div className="modal-body">
                    {_("This system is not registered to Red Hat Insights.")}
                </div>
            )
        },
        {
            cancel_caption: _("Close"),
            actions: [
                {
                    caption: _("Register"),
                    style: "primary",
                    clicked: register
                }
            ]
        }
    );
}

function show_unregister_dialog() {
    show_modal_dialog(
        {
            title: _("Unregister from Red Hat Insights"),
            body: (
                <div className="modal-body">
                    {_("This system is currently registered to Red Hat Insights.")}
                    <br/>
                    <br/>
                    <div className="alert alert-warning">
                        <span className="pficon pficon-warning-triangle-o"/>
                        <span>{_("If you unregister this system from Insights, it will no longer report it's Insights status in Customer Portal or Satellite.")}</span>
                    </div>
                </div>
            )
        },
        {
            actions: [
                {
                    caption: _("Unregister"),
                    style: "danger",
                    clicked: unregister
                }
            ]
        }
    );
}

function monitor_status(callback) {
    // The insights-client unfortunately doesn't expose its status in
    // a readily consumable way, so we tickle it out in a hackish way.
    //
    // There are some ideas for how to improve this, see
    // https://github.com/RedHatInsights/insights-core/issues/1939

    let status_content;
    let tz_offset = "", registered_content, last_upload_content;

    function update() {
        let status;

        if (status_content) {
            console.log(status_content);
            try {
                status = JSON.parse(status_content);
            } catch (e) {
                console.warn("Failed to parse Insights status", status_content, e);
            }
            if (status)
                callback(status);
            return;
        }

        status = {
            registered: registered_content !== null,
            lastupload: last_upload_content ? Date.parse(last_upload_content.trim() + tz_offset) / 1000 || true : null
        };
        callback(status);
    }

    let status_file = cockpit.file("/var/lib/insights/status");
    status_file.watch(data => { status_content = data; update() });

    // For the hack

    cockpit.spawn([ "date", "+%:z" ]).then(data => { tz_offset = data.trim(); update() });

    let registered_file = cockpit.file("/etc/insights-client/.registered");
    registered_file.watch(data => { registered_content = data; update() });

    let lastupload_file = cockpit.file("/etc/insights-client/.lastupload")
    lastupload_file.watch(data => { last_upload_content = data; update() });

    return {
        close: () => {
            status_file.close();
            registered_file.close();
            lastupload_file.close();
        }
    }
}

export class InsightsStatus extends React.Component {
    constructor() {
        super();
        this.state = { status: null };
    }

    componentDidMount() {
        this.monitor = monitor_status(status => this.setState({ status: status }));
    }

    componentWillUnmount() {
        this.monitor.close();
    }

    render() {
        let { status } = this.state;

        if (!status)
            return null;

        let text, button;

        function left(func) {
            return function (event) {
                if (!event || event.button !== 0)
                    return;
                func();
                event.stopPropagation();
            }
        }

        if (status.registered) {
            if (status.lastupload === true) {
                text = _("Registered");
            } else if (status.lastupload) {
                text = cockpit.format(_("Registered, last upload $0"), moment(status.lastupload * 1000).fromNow());
            } else
                text = _("Registered, no upload yet");
            button = (
                <button className="btn btn-primary" onClick={left(show_unregister_dialog)}>
                    {_("Unregister")}
                </button>
            );
        } else {
            text = _("Not registered");
            button = (
                <button className="btn btn-primary" onClick={left(show_register_dialog)}>
                    {_("Register")}
                </button>
            );
        }

        return (
            <div>
                <label>{_("Insights:")} {text}</label>
                {button}
            </div>
        );
    }
}
