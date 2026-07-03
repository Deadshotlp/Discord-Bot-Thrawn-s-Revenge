// Kategorisiert die Teilnahme anhand der An-/Abmeldeliste und der Personen,
// die zum Auswertungszeitpunkt tatsächlich im Voice-Channel sind.
//
// - anwesend    = im Voice-Channel (unabhängig von der Anmeldung)
// - entschuldigt = abgemeldet und nicht im Voice
// - unentschuldigt = angemeldet, aber nicht im Voice und nicht abgemeldet
//
// registrations: [{ userId, state: "registered" | "declined" }]
// voiceUserIds: Set/Array der User-IDs im Voice-Channel
export function evaluateAttendance(registrations, voiceUserIds) {
  const present = new Set([...voiceUserIds]);
  const declined = new Set();
  const registered = new Set();

  for (const entry of registrations) {
    if (entry.state === "declined") {
      declined.add(entry.userId);
    } else if (entry.state === "registered") {
      registered.add(entry.userId);
    }
  }

  const presentIds = [...present];

  const excusedIds = [...declined].filter((userId) => !present.has(userId));

  const absentIds = [...registered].filter(
    (userId) => !present.has(userId) && !declined.has(userId)
  );

  return { presentIds, excusedIds, absentIds };
}
