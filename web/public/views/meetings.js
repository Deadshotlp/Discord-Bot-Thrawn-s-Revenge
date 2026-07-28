import { ACCESS, api } from "../lib/api.js";
import {
  badge,
  card,
  clear,
  confirmDialog,
  field,
  formatDateTime,
  h,
  modal,
  select,
  spinner,
  table,
  toast
} from "../lib/ui.js";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function channelOptions(channels, includeEmpty = true) {
  return [
    ...(includeEmpty ? [{ value: "", label: "– nicht gesetzt –" }] : []),
    ...channels.map((channel) => ({
      value: channel.id,
      label: channel.parent ? `${channel.parent} / ${channel.name}` : channel.name
    }))
  ];
}

function roleCheckboxes(name, roles, selected = []) {
  const chosen = new Set(selected);

  return h("div", { style: { maxHeight: "170px", overflowY: "auto", display: "grid", gap: "4px" } },
    ...roles.slice(0, 100).map((role) =>
      h("label.switch", { style: { fontSize: "13px" } },
        h("input", {
          type: "checkbox",
          name,
          value: role.id,
          checked: chosen.has(role.id),
          style: { width: "16px", height: "16px", appearance: "auto" }
        }),
        h("span", { style: { color: role.color !== "#000000" ? role.color : "inherit" } }, role.name))));
}

function readCheckboxes(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function meetingForm(guild, values = {}) {
  return h("div", {},
    field("Name", h("input.input", { name: "name", required: true, value: values.name || "" })),
    h("div.field-row", {},
      field("Ankündigungs-Channel", select(channelOptions(guild.channels.text), {
        name: "announceChannelId", value: values.announceChannelId || ""
      })),
      field("Voice-Channel", select(channelOptions(guild.channels.voice), {
        name: "voiceChannelId", value: values.voiceChannelId || ""
      }))),
    h("div.field-row", {},
      field("Wochentag", select(WEEKDAYS.map((label, index) => ({ value: index + 1, label })), {
        name: "weekday", value: values.weekday || 3
      })),
      field("Uhrzeit", h("input.input", {
        name: "time", type: "time",
        value: `${String(values.hour ?? 20).padStart(2, "0")}:${String(values.minute ?? 0).padStart(2, "0")}`
      }))),
    h("div.field-row", {},
      field("Rhythmus (Wochen)", h("input.input", {
        name: "intervalWeeks", type: "number", min: 1, max: 52, value: values.intervalWeeks || 1
      })),
      field("Vorlaufzeit (Stunden)", h("input.input", {
        name: "leadTimeHours", type: "number", min: 1, max: 336, value: values.leadTimeHours || 24
      }), "Wann die Ankündigung erscheint")),
    field("Teilnehmer-Rollen", roleCheckboxes("participantRoleIds", guild.roles, values.participantRoleIds)),
    field("Organisator-Rollen", roleCheckboxes("organizerRoleIds", guild.roles, values.organizerRoleIds)));
}

function toMeetingPayload(data, form) {
  const [hour, minute] = String(data.time || "20:00").split(":").map(Number);

  return {
    name: data.name,
    announceChannelId: data.announceChannelId,
    voiceChannelId: data.voiceChannelId,
    weekday: Number(data.weekday),
    hour,
    minute,
    intervalWeeks: Number(data.intervalWeeks),
    leadTimeHours: Number(data.leadTimeHours),
    participantRoleIds: readCheckboxes(form, "participantRoleIds"),
    organizerRoleIds: readCheckboxes(form, "organizerRoleIds")
  };
}

export async function renderMeetings({ guildId, guild }) {
  const container = h("div.stack");
  const canManage = guild.accessLevel >= ACCESS.LEAD;

  async function refresh() {
    clear(container).append(spinner());
    const meetings = await api.meetings(guildId);

    clear(container).append(
      h("div.page-header", {},
        h("h1", {}, "Meetings"),
        canManage
          ? h("div.page-actions", {},
            h("button.btn.btn-primary", {
              onClick: () => modal("Meeting anlegen", meetingForm(guild), {
                submitLabel: "Anlegen",
                onSubmit: async (data, form) => {
                  await api.createMeeting(guildId, toMeetingPayload(data, form));
                  toast("Meeting angelegt.", "success");
                  await refresh();
                }
              })
            }, "+ Meeting anlegen"))
          : null),

      meetings.length === 0
        ? card("Keine Meetings", h("p.muted", {}, "Lege ein wiederkehrendes Meeting an – der Bot kündigt es an, sammelt An-/Abmeldungen und wertet die Anwesenheit aus."))
        : h("div.stack", {}, ...meetings.map((meeting) => {
          const registered = meeting.attendance.filter((entry) => entry.state === "registered").length;
          const declined = meeting.attendance.filter((entry) => entry.state === "declined").length;

          return card(
            h("div.row-between", { style: { width: "100%" } },
              h("span", {}, meeting.name, " ", badge(meeting.scheduleLabel, "info")),
              canManage
                ? h("div.row", {},
                  h("button.btn.btn-sm", {
                    onClick: () => modal(`${meeting.name} bearbeiten`, meetingForm(guild, meeting), {
                      onSubmit: async (data, form) => {
                        await api.updateMeeting(guildId, meeting.id, toMeetingPayload(data, form));
                        toast("Gespeichert.", "success");
                        await refresh();
                      }
                    })
                  }, "Bearbeiten"),
                  h("button.btn.btn-sm.btn-danger", {
                    onClick: async () => {
                      if (!confirmDialog(`Meeting „${meeting.name}“ löschen?`)) {
                        return;
                      }

                      await api.deleteMeeting(guildId, meeting.id);
                      await refresh();
                    }
                  }, "Löschen"))
                : null),

            h("div.grid.grid-4", { style: { marginBottom: "14px" } },
              h("div.stat", {},
                h("div.stat-value", { style: { fontSize: "17px" } }, formatDateTime(meeting.nextOccurrence)),
                h("div.stat-label", {}, "Nächster Termin")),
              h("div.stat", {},
                h("div.stat-value", { style: { fontSize: "17px" } }, String(registered)),
                h("div.stat-label", {}, "Angemeldet")),
              h("div.stat", {},
                h("div.stat-value", { style: { fontSize: "17px" } }, String(declined)),
                h("div.stat-label", {}, "Abgemeldet")),
              h("div.stat", {},
                h("div.stat-value", { style: { fontSize: "17px" } },
                  meeting.announceChannelId ? `#${guild.channels.text.find((c) => c.id === meeting.announceChannelId)?.name || "?"}` : "–"),
                h("div.stat-label", {}, "Ankündigung"))),

            h("div.row-between", { style: { marginBottom: "8px" } },
              h("strong", { style: { fontSize: "14px" } }, `Agenda (${meeting.topics.length})`),
              h("button.btn.btn-sm", {
                onClick: () => modal("Thema einreichen",
                  h("div", {},
                    field("Titel", h("input.input", { name: "title", required: true, maxlength: 200 })),
                    field("Beschreibung (optional)", h("textarea.input", { name: "description", maxlength: 1000 })),
                    canManage
                      ? h("label.switch", {}, h("input", { type: "checkbox", name: "standing" }), "Dauerthema (🔁 kehrt jedes Mal wieder)")
                      : null), {
                    submitLabel: "Einreichen",
                    onSubmit: async (data) => {
                      await api.addTopic(guildId, meeting.id, {
                        title: data.title,
                        description: data.description,
                        standing: data.standing === "on"
                      });

                      toast("Thema eingereicht.", "success");
                      await refresh();
                    }
                  })
              }, "+ Thema")),

            table(["#", "Thema", "Von", "Typ", ""],
              meeting.topics.map((topic, index) => [
                String(index + 1),
                h("div", {},
                  h("strong", {}, topic.title),
                  topic.description ? h("div.muted", { style: { fontSize: "12px" } }, topic.description) : null),
                h("span.mono", { style: { fontSize: "12px" } }, topic.authorId),
                topic.standing ? badge("🔁 Dauerthema", "info") : badge("einmalig", "neutral"),
                canManage
                  ? h("div.row", {},
                    h("button.btn.btn-sm", {
                      onClick: async () => {
                        await api.updateTopic(guildId, meeting.id, topic.id, { move: "up" });
                        await refresh();
                      }
                    }, "↑"),
                    h("button.btn.btn-sm", {
                      onClick: async () => {
                        await api.updateTopic(guildId, meeting.id, topic.id, { move: "down" });
                        await refresh();
                      }
                    }, "↓"),
                    h("button.btn.btn-sm", {
                      onClick: async () => {
                        await api.updateTopic(guildId, meeting.id, topic.id, { standing: !topic.standing });
                        await refresh();
                      }
                    }, topic.standing ? "einmalig" : "🔁"),
                    h("button.btn.btn-sm.btn-danger", {
                      onClick: async () => {
                        await api.deleteTopic(guildId, meeting.id, topic.id);
                        await refresh();
                      }
                    }, "×"))
                  : "–"
              ]),
              { empty: "Noch keine Themen eingereicht." }));
        })));
  }

  await refresh();
  return container;
}
