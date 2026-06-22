-- KannoProxy rpcd backend
local sys = require "luci.sys"
local uci = require "luci.model.uci".cursor()
local json = require "luci.jsonc"
local io = require "io"

local M = {}

-- Helper: run shell command and return output
local function sh(cmd)
    local f = io.popen(cmd .. " 2>/dev/null")
    if not f then return "" end
    local out = f:read("*a") or ""
    f:close()
    return out:gsub("[\r\n]+$", "")
end

-- Helper: run shell command and return lines as table
local function sh_lines(cmd)
    local out = sh(cmd)
    local lines = {}
    for line in (out .. "\n"):gmatch("([^\n]*)\n") do
        if #line > 0 then lines[#lines + 1] = line end
    end
    return lines
end

function M.get_status()
    local status = sh("kanno status")
    local kernel = uci:get("kanno", "global", "kernel") or "mihomo"
    local mode   = uci:get("kanno", "global", "mode") or "rule"

    local version = ""
    if status == "running" then
        if kernel == "mihomo" then
            version = sh("mihomo -v 2>&1 | head -1")
        else
            version = sh("sing-box version 2>&1 | head -1")
        end
    end

    -- Query mihomo API for connections/traffic (best-effort)
    local conns = 0
    local traffic_up, traffic_down = 0, 0
    if status == "running" and kernel == "mihomo" then
        local api = sh("curl -sf http://127.0.0.1:9090/connections 2>/dev/null")
        if api and #api > 0 then
            local obj = json.parse(api)
            if obj then
                conns = obj.connections and #obj.connections or 0
            end
        end
    end

    return {
        running      = (status == "running"),
        kernel       = kernel,
        version      = version,
        mode         = mode,
        connections  = conns,
        traffic_up   = traffic_up,
        traffic_down = traffic_down,
    }
end

function M.get_nodes()
    local nodes = {}
    uci:foreach("kanno", "proxy", function(s)
        nodes[#nodes + 1] = {
            id       = s[".name"]:gsub("proxy_", ""),
            name     = s.name or "",
            type     = s.type or "",
            server   = s.server or "",
            port     = s.port or "",
            enabled  = (s.enabled ~= "0"),
            security = s.security or "none",
            transport = s.transport or "tcp",
        }
    end)
    return { nodes = nodes }
end

function M.add_node(params)
    local uri = params and params.uri
    if not uri or uri == "" then
        return { ok = false, error = "uri required" }
    end
    -- Sanitize - only allow expected URI schemes
    if not uri:match("^(vless|vmess|trojan|ss|hy2|hysteria2|tuic|naive%+https)://") then
        return { ok = false, error = "unsupported URI scheme" }
    end

    -- Escape the URI safely for shell (no shell expansion)
    local tmpfile = "/tmp/kanno_uri_input"
    local f = io.open(tmpfile, "w")
    if not f then return { ok = false, error = "cannot write tmp file" } end
    f:write(uri)
    f:close()

    local id = sh("kanno add \"$(cat /tmp/kanno_uri_input)\" | grep -o '[0-9a-f]\\{8\\}'")
    os.remove(tmpfile)

    if id and #id == 8 then
        local name = uci:get("kanno", "proxy_" .. id, "name") or ""
        return { ok = true, id = id, name = name }
    else
        return { ok = false, error = "parse failed" }
    end
end

function M.del_node(params)
    local id = params and params.id
    if not id or not id:match("^[0-9a-f]+$") then
        return { ok = false, error = "invalid id" }
    end
    uci:delete("kanno", "proxy_" .. id)
    uci:commit("kanno")
    return { ok = true }
end

function M.toggle_node(params)
    local id = params and params.id
    local enabled = params and params.enabled
    if not id or not id:match("^[0-9a-f]+$") then
        return { ok = false, error = "invalid id" }
    end
    uci:set("kanno", "proxy_" .. id, "enabled", enabled and "1" or "0")
    uci:commit("kanno")
    return { ok = true }
end

function M.test_node(params)
    local id = params and params.id
    if not id or not id:match("^[0-9a-f]+$") then
        return { ok = false, error = "invalid id" }
    end
    local result = sh("kanno test " .. id)
    local latency = result:match("(%d+)ms")
    return {
        ok      = result ~= "timeout",
        latency = tonumber(latency),
        result  = result,
    }
end

function M.test_all_nodes()
    local results = {}
    uci:foreach("kanno", "proxy", function(s)
        local id = s[".name"]:gsub("proxy_", "")
        local r = sh("kanno test " .. id)
        local latency = r:match("(%d+)ms")
        results[#results + 1] = {
            id      = id,
            ok      = r ~= "timeout",
            latency = tonumber(latency),
        }
    end)
    return { results = results }
end

function M.get_groups()
    local groups = {}
    uci:foreach("kanno", "proxygroup", function(s)
        local proxies = {}
        if type(s.proxies) == "table" then
            proxies = s.proxies
        elseif type(s.proxies) == "string" then
            proxies = { s.proxies }
        end
        groups[#groups + 1] = {
            id        = s[".name"]:gsub("group_", ""),
            name      = s.name or "",
            type      = s.type or "url-test",
            proxies   = proxies,
            url       = s.url or "http://www.gstatic.com/generate_204",
            interval  = tonumber(s.interval) or 300,
            tolerance = tonumber(s.tolerance) or 50,
        }
    end)
    return { groups = groups }
end

function M.save_groups(params)
    local groups = params and params.groups
    if type(groups) ~= "table" then
        return { ok = false, error = "groups must be array" }
    end
    -- Delete existing groups
    uci:foreach("kanno", "proxygroup", function(s) uci:delete("kanno", s[".name"]) end)
    -- Re-create
    for _, g in ipairs(groups) do
        local sec = "group_" .. (g.id or g.name:lower():gsub("[^a-z0-9]", "_"))
        uci:set("kanno", sec, "proxygroup")
        uci:set("kanno", sec, "name", g.name or "")
        uci:set("kanno", sec, "type", g.type or "url-test")
        uci:set("kanno", sec, "url", g.url or "http://www.gstatic.com/generate_204")
        uci:set("kanno", sec, "interval", tostring(g.interval or 300))
        uci:set("kanno", sec, "tolerance", tostring(g.tolerance or 50))
        if type(g.proxies) == "table" then
            uci:set("kanno", sec, "proxies", g.proxies)
        end
    end
    uci:commit("kanno")
    return { ok = true }
end

function M.get_rules()
    local r = {}
    r.geosite_cn     = uci:get("kanno", "rules", "geosite_cn") or "DIRECT"
    r.geoip_cn       = uci:get("kanno", "rules", "geoip_cn") or "DIRECT"
    r.default_policy = uci:get("kanno", "rules", "default_policy") or "PROXY"

    -- Read custom rule files
    local function read_file(path)
        local lines = {}
        local f = io.open(path, "r")
        if not f then return lines end
        for line in f:lines() do
            if not line:match("^#") and #line > 0 then
                lines[#lines + 1] = line
            end
        end
        f:close()
        return lines
    end
    r.force_proxy  = read_file("/etc/kanno/rules/force_proxy.txt")
    r.force_direct = read_file("/etc/kanno/rules/force_direct.txt")
    return r
end

function M.save_rules(params)
    if not params then return { ok = false } end
    local function write_file(path, lines)
        local f = io.open(path, "w")
        if not f then return end
        f:write("# KannoProxy custom rules\n")
        for _, line in ipairs(lines or {}) do
            f:write(line .. "\n")
        end
        f:close()
    end
    uci:set("kanno", "rules", "geosite_cn",     params.geosite_cn or "DIRECT")
    uci:set("kanno", "rules", "geoip_cn",       params.geoip_cn or "DIRECT")
    uci:set("kanno", "rules", "default_policy", params.default_policy or "PROXY")
    uci:commit("kanno")
    write_file("/etc/kanno/rules/force_proxy.txt",  params.force_proxy)
    write_file("/etc/kanno/rules/force_direct.txt", params.force_direct)
    return { ok = true }
end

function M.get_global()
    return {
        enabled   = uci:get("kanno", "global", "enabled") ~= "0",
        kernel    = uci:get("kanno", "global", "kernel") or "mihomo",
        mode      = uci:get("kanno", "global", "mode") or "rule",
        log_level = uci:get("kanno", "global", "log_level") or "info",
        ipv6      = uci:get("kanno", "global", "ipv6") ~= "1",
    }
end

function M.save_global(params)
    if not params then return { ok = false } end
    local allowed_kernels = { mihomo = true, singbox = true }
    local allowed_modes   = { rule = true, global = true, direct = true }
    local kernel    = params.kernel or "mihomo"
    local mode      = params.mode or "rule"
    if not allowed_kernels[kernel] then kernel = "mihomo" end
    if not allowed_modes[mode]     then mode = "rule" end
    uci:set("kanno", "global", "enabled",   params.enabled and "1" or "0")
    uci:set("kanno", "global", "kernel",    kernel)
    uci:set("kanno", "global", "mode",      mode)
    uci:set("kanno", "global", "log_level", params.log_level or "info")
    uci:set("kanno", "global", "ipv6",      params.ipv6 and "1" or "0")
    uci:commit("kanno")
    return { ok = true }
end

function M.get_dns()
    return {
        enabled      = uci:get("kanno", "dns", "enabled") ~= "0",
        mode         = uci:get("kanno", "dns", "mode") or "fake-ip",
        listen_port  = tonumber(uci:get("kanno", "dns", "listen_port")) or 1053,
        domestic_dns = uci:get_list("kanno", "dns", "domestic_dns") or { "114.114.114.114", "223.5.5.5" },
        foreign_dns  = uci:get_list("kanno", "dns", "foreign_dns") or { "8.8.8.8", "1.1.1.1" },
    }
end

function M.save_dns(params)
    if not params then return { ok = false } end
    uci:set("kanno", "dns", "enabled",     params.enabled and "1" or "0")
    uci:set("kanno", "dns", "mode",        params.mode or "fake-ip")
    uci:set("kanno", "dns", "listen_port", tostring(params.listen_port or 1053))
    if type(params.domestic_dns) == "table" then
        uci:set("kanno", "dns", "domestic_dns", params.domestic_dns)
    end
    if type(params.foreign_dns) == "table" then
        uci:set("kanno", "dns", "foreign_dns", params.foreign_dns)
    end
    uci:commit("kanno")
    return { ok = true }
end

function M.get_kernels()
    local function ver(bin, cmd)
        if not sys.exec("test -x " .. bin .. " 2>/dev/null; echo $?"):match("^0") then
            return { installed = false, version = "" }
        end
        return {
            installed = true,
            version   = sh(bin .. " " .. cmd .. " 2>&1 | head -1"),
            path      = bin,
        }
    end
    return {
        mihomo  = ver("/usr/bin/mihomo",   "-v"),
        singbox = ver("/usr/bin/sing-box", "version"),
        geodata = {
            version = sh("cat /etc/kanno/geodata/version 2>/dev/null"),
            geoip   = sh("test -f /etc/kanno/geodata/geoip.dat && echo yes || echo no"),
            geosite = sh("test -f /etc/kanno/geodata/geosite.dat && echo yes || echo no"),
        },
    }
end

function M.update_kernel(params)
    local target = params and params.target
    if not target or not target:match("^[a-z]+$") then
        return { ok = false, error = "invalid target" }
    end
    -- Run in background
    sys.exec("kanno update " .. target .. " > /tmp/kanno-update.log 2>&1 &")
    return { ok = true, message = "Update started in background. Check /tmp/kanno-update.log" }
end

function M.restart()
    sys.exec("kanno restart > /tmp/kanno-restart.log 2>&1 &")
    return { ok = true }
end

function M.stop()
    sys.exec("kanno stop")
    return { ok = true }
end

function M.get_logs(params)
    local lines = (params and tonumber(params.lines)) or 100
    if lines > 500 then lines = 500 end
    return {
        lines = sh_lines("tail -n " .. lines .. " /var/log/kanno.log 2>/dev/null")
    }
end

return M
