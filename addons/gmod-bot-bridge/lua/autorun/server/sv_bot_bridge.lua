--[[
    Bot-Bridge für Garry's Mod
    ==========================
    Meldet die Spielerliste (SteamID64 + Spielzeit) an den Discord-Bot und
    ermöglicht das Verknüpfen von Steam und Discord direkt im Spiel.

    Einrichtung
    -----------
    1. Diesen Ordner nach garrysmod/addons/ kopieren.
    2. Im Bot-Dashboard unter „Server-Monitoring“ beim jeweiligen Server einen
       Ingest-Token erzeugen.
    3. In der server.cfg eintragen:

           botbridge_url  "https://dashboard.example.de"
           botbridge_token "<Token aus dem Dashboard>"

       Alternativ unten die Standardwerte anpassen.

    Datenschutz: Übertragen werden SteamID64, Spielername und die Spielzeit auf
    diesem Server – nichts weiter.
]]--

local CONFIG = {
    url      = "",           -- Fallback, wenn keine ConVar gesetzt ist
    token    = "",           -- Fallback, wenn keine ConVar gesetzt ist
    interval = 60,           -- Sekunden zwischen zwei Meldungen
    command  = "!discord"    -- Chat-Befehl für die Verknüpfung
}

local urlConVar   = CreateConVar("botbridge_url", CONFIG.url, FCVAR_PROTECTED, "Basis-URL des Bot-Dashboards")
local tokenConVar = CreateConVar("botbridge_token", CONFIG.token, FCVAR_PROTECTED, "Ingest-Token des Servers")

local function baseUrl()
    local value = string.Trim(urlConVar:GetString())
    return (value ~= "" and value or CONFIG.url):gsub("/+$", "")
end

local function token()
    local value = string.Trim(tokenConVar:GetString())
    return value ~= "" and value or CONFIG.token
end

local function isConfigured()
    return baseUrl() ~= "" and token() ~= ""
end

local function post(path, payload, onSuccess, onFailure)
    if not isConfigured() then return end

    HTTP({
        url     = baseUrl() .. path,
        method  = "POST",
        type    = "application/json",
        body    = util.TableToJSON(payload),
        headers = { ["x-ingest-token"] = token() },
        success = function(code, body)
            if code < 200 or code >= 300 then
                if onFailure then onFailure("HTTP " .. code) end
                return
            end

            if onSuccess then onSuccess(util.JSONToTable(body or "{}") or {}) end
        end,
        failed = function(reason)
            if onFailure then onFailure(reason) end
        end
    })
end

-- Spielerliste melden -------------------------------------------------------

local function collectPlayers()
    local players = {}

    for _, ply in ipairs(player.GetAll()) do
        if IsValid(ply) and not ply:IsBot() then
            table.insert(players, {
                steamId         = ply:SteamID64() or "",
                name            = ply:Nick(),
                durationSeconds = math.floor(ply:TimeConnected()),
                score           = ply:Frags()
            })
        end
    end

    return players
end

local function reportPlayers()
    if not isConfigured() then return end

    post("/api/ingest/players", { players = collectPlayers() }, nil, function(reason)
        MsgN("[BotBridge] Spielerliste konnte nicht gemeldet werden: " .. tostring(reason))
    end)
end

timer.Create("BotBridge_Report", CONFIG.interval, 0, reportPlayers)

hook.Add("PlayerInitialSpawn", "BotBridge_JoinReport", function()
    timer.Simple(3, reportPlayers)
end)

hook.Add("PlayerDisconnected", "BotBridge_LeaveReport", function()
    timer.Simple(1, reportPlayers)
end)

-- Discord-Verknüpfung im Chat ----------------------------------------------

hook.Add("PlayerSay", "BotBridge_LinkCommand", function(ply, text)
    local trimmed = string.Trim(text)
    local prefix, code = string.match(trimmed, "^(%S+)%s+(%S+)$")

    if not prefix or string.lower(prefix) ~= string.lower(CONFIG.command) then
        if string.lower(trimmed) == string.lower(CONFIG.command) then
            ply:ChatPrint("[Discord] Nutze " .. CONFIG.command .. " <CODE>. Den Code bekommst du in Discord mit /steam verknuepfen.")
            return ""
        end

        return
    end

    if not isConfigured() then
        ply:ChatPrint("[Discord] Die Verknüpfung ist auf diesem Server nicht eingerichtet.")
        return ""
    end

    post("/api/ingest/link", {
        code    = string.upper(code),
        steamId = ply:SteamID64()
    }, function(response)
        if IsValid(ply) then
            ply:ChatPrint("[Discord] " .. (response.message or (response.ok and "Verknüpft." or "Fehlgeschlagen.")))
        end
    end, function(reason)
        if IsValid(ply) then
            ply:ChatPrint("[Discord] Verbindung zum Bot fehlgeschlagen (" .. tostring(reason) .. ").")
        end
    end)

    return ""
end)

hook.Add("Initialize", "BotBridge_Startup", function()
    if isConfigured() then
        MsgN("[BotBridge] Aktiv – meldet an " .. baseUrl())
    else
        MsgN("[BotBridge] Inaktiv: botbridge_url und botbridge_token setzen.")
    end
end)
