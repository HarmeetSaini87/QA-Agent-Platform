# QA Agent Platform — HTTPS / TLS Setup Guide

> **When to use this guide:** After completing the base installation (`install.ps1` / `install.sh`).  
> The platform runs HTTP by default. This guide adds HTTPS using your preferred approach.

---

## Choose Your Approach

| Approach | Best for | Effort |
|---|---|---|
| [A — nginx reverse proxy](#a--nginx-reverse-proxy-recommended) | Linux servers, most common | ~15 min |
| [B — IIS reverse proxy](#b--iis-reverse-proxy-windows) | Windows servers with IIS already installed | ~20 min |
| [C — Self-signed certificate (dev/internal only)](#c--self-signed-certificate-devinternalonly) | Internal tools, no public domain | ~10 min |
| [D — Certbot / Let's Encrypt](#d--certbot--lets-encrypt-free-public-cert) | Public internet-facing servers | ~20 min |

---

## A — nginx Reverse Proxy (Recommended)

nginx sits in front of the Node.js server, handles TLS, and forwards requests to port 3003/3000.

### 1. Install nginx

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install -y nginx
```

**RHEL / CentOS / Rocky:**
```bash
sudo dnf install -y nginx
sudo systemctl enable nginx
```

### 2. Obtain a TLS certificate

**Option 1 — Certbot (free, public domain required):**
```bash
sudo apt install -y certbot python3-certbot-nginx   # Ubuntu
sudo certbot --nginx -d qa.yourcompany.com
```
Certbot auto-configures nginx and sets up auto-renewal. Skip to step 4.

**Option 2 — Company / CA-signed certificate:**
Place your files at:
```
/etc/ssl/qa-platform/qa-platform.crt   ← full chain certificate
/etc/ssl/qa-platform/qa-platform.key   ← private key
```
```bash
sudo mkdir -p /etc/ssl/qa-platform
sudo chmod 700 /etc/ssl/qa-platform
# copy your .crt and .key files here
```

### 3. Create nginx site config

Replace `qa.yourcompany.com` and the cert paths with your values.  
Replace `3000` with your actual platform port (`UI_PORT` in `.env`).

```bash
sudo nano /etc/nginx/sites-available/qa-platform
```

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name qa.yourcompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name qa.yourcompany.com;

    ssl_certificate     /etc/ssl/qa-platform/qa-platform.crt;
    ssl_certificate_key /etc/ssl/qa-platform/qa-platform.key;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    # Proxy to Node.js
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;   # allow long-running suite runs
        proxy_send_timeout 300s;
    }

    # SSE endpoints need special buffering settings (recorder + debug streams)
    location ~ ^/api/(recorder/stream|debug/stream) {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Connection '';
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### 4. Enable the site and reload

```bash
sudo ln -s /etc/nginx/sites-available/qa-platform /etc/nginx/sites-enabled/
sudo nginx -t          # test config — must say "syntax is ok"
sudo systemctl reload nginx
```

### 5. Verify

```bash
curl -I https://qa.yourcompany.com
# → HTTP/2 200
```

### 6. Update platform `.env`

```bash
sudo nano /opt/qa-agent-platform/.env
```
Add or update:
```env
APP_BASE_URL=https://qa.yourcompany.com
```
Then restart:
```bash
sudo systemctl restart qa-agent-platform
```

---

## B — IIS Reverse Proxy (Windows)

### Prerequisites
- IIS installed with **Application Request Routing (ARR)** and **URL Rewrite** modules
- Download ARR: https://www.iis.net/downloads/microsoft/application-request-routing
- Download URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite

### 1. Bind the TLS certificate in IIS

1. Open **IIS Manager**
2. Click the server node → **Server Certificates**
3. Import your `.pfx` certificate (Actions pane → **Import**)
4. Note the certificate friendly name

### 2. Create the IIS Site

```powershell
# Run as Administrator
$siteName   = "QA-Platform"
$port       = 443
$certThumb  = "YOUR_CERT_THUMBPRINT"   # Get-ChildItem Cert:\LocalMachine\My
$installDir = "C:\qa-agent-platform"
$platformPort = 3000   # UI_PORT in .env

# Create site folder (IIS needs a physical path)
New-Item -ItemType Directory -Force -Path "$installDir\iis-root" | Out-Null

# Create IIS App Pool (no managed code — Node.js is not .NET)
New-WebAppPool -Name $siteName
Set-ItemProperty IIS:\AppPools\$siteName managedRuntimeVersion ""

# Create IIS Site
New-Website -Name $siteName -Port $port -PhysicalPath "$installDir\iis-root" `
    -ApplicationPool $siteName -Ssl

# Bind certificate to site
$binding = Get-WebBinding -Name $siteName -Protocol "https"
$binding.AddSslCertificate($certThumb, "My")
```

### 3. Add web.config for reverse proxy

Create `C:\qa-agent-platform\iis-root\web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- Redirect HTTP to HTTPS -->
        <rule name="HTTP to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="^OFF$" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>

        <!-- Proxy all requests to Node.js -->
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3000/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>

    <!-- Disable IIS response buffering for SSE streams -->
    <httpProtocol>
      <customHeaders>
        <add name="X-Frame-Options" value="DENY" />
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" />
      </customHeaders>
    </httpProtocol>

    <security>
      <requestFiltering allowDoubleEscaping="true" />
    </security>
  </system.webServer>
</configuration>
```

### 4. Enable ARR proxy at server level

```powershell
# Enable proxy in ARR
$arrFeature = Get-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled"
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled" -value "True"
```

### 5. Add HTTP redirect site (port 80)

```powershell
New-Website -Name "QA-Platform-HTTP" -Port 80 `
    -PhysicalPath "$installDir\iis-root" -ApplicationPool $siteName
```
The `web.config` rule above handles the HTTP → HTTPS redirect automatically.

### 6. Verify and update `.env`

```powershell
Invoke-WebRequest https://qa.yourcompany.com -UseBasicParsing | Select StatusCode
# → 200

# Update .env
(Get-Content "$installDir\.env") -replace 'APP_BASE_URL=.*', `
    'APP_BASE_URL=https://qa.yourcompany.com' | Set-Content "$installDir\.env"

# Restart platform service
Restart-Service QAAgentPlatform
```

---

## C — Self-Signed Certificate (Dev/Internal Only)

> **Warning:** Browsers will show a security warning. Only suitable for internal/dev use where you control the machines that access the platform.

### Linux — generate and wire into nginx

```bash
sudo mkdir -p /etc/ssl/qa-platform

# Generate 5-year self-signed cert
sudo openssl req -x509 -nodes -days 1825 -newkey rsa:2048 \
    -keyout /etc/ssl/qa-platform/qa-platform.key \
    -out    /etc/ssl/qa-platform/qa-platform.crt \
    -subj "/C=US/ST=Internal/L=Internal/O=QA Platform/CN=qa-platform.internal" \
    -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}'),DNS:qa-platform.internal"

sudo chmod 600 /etc/ssl/qa-platform/qa-platform.key
```

Then follow [Section A](#a--nginx-reverse-proxy-recommended) steps 3–6 using the generated cert paths.

**To trust the cert on client machines:**
- Copy `/etc/ssl/qa-platform/qa-platform.crt` to client machines
- **Windows:** Double-click → Install Certificate → Local Machine → Trusted Root Certification Authorities
- **Mac:** Keychain Access → drag in cert → Trust Always
- **Chrome/Firefox Linux:** Settings → Privacy → Certificates → Import

### Windows — generate self-signed cert with PowerShell

```powershell
# Run as Administrator
$cert = New-SelfSignedCertificate `
    -DnsName "qa-platform.internal", "localhost" `
    -CertStoreLocation "cert:\LocalMachine\My" `
    -NotAfter (Get-Date).AddYears(5) `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -FriendlyName "QA Agent Platform"

Write-Host "Thumbprint: $($cert.Thumbprint)"
```

Then follow [Section B](#b--iis-reverse-proxy-windows) using this thumbprint.

---

## D — Certbot / Let's Encrypt (Free Public Cert)

> **Requires:** A public domain name pointing to your server's IP. Port 80 must be reachable from the internet for domain validation.

```bash
# Ubuntu / Debian
sudo apt install -y certbot python3-certbot-nginx

# RHEL / CentOS / Rocky
sudo dnf install -y certbot python3-certbot-nginx

# Issue cert (replace with your domain)
sudo certbot --nginx -d qa.yourcompany.com

# Certbot auto-configures nginx and schedules renewal
# Test auto-renewal
sudo certbot renew --dry-run
```

Certs renew automatically every 60 days via a systemd timer. Verify:
```bash
systemctl list-timers | grep certbot
```

---

## Post-HTTPS Checklist

- [ ] `https://` URL loads with green padlock
- [ ] `http://` redirects to `https://` (301)
- [ ] `/api/health` returns `200` over HTTPS: `curl -s https://qa.yourcompany.com/api/health`
- [ ] Recorder SSE stream works (open a recording session — check browser console for errors)
- [ ] Debugger SSE stream works (start a debug session — steps stream correctly)
- [ ] `APP_BASE_URL` in `.env` updated to `https://...` and service restarted
- [ ] Login page loads correctly
- [ ] Suite run completes successfully end-to-end

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Node.js not running | `systemctl status qa-agent-platform` / `nssm status QAAgentPlatform` |
| SSE stream disconnects immediately | nginx `proxy_buffering` not off | Ensure `proxy_buffering off` in SSE location block |
| `ERR_CERT_AUTHORITY_INVALID` | Self-signed cert not trusted | Install cert in OS/browser trust store |
| Mixed content warnings | `APP_BASE_URL` still `http://` | Update `.env` → `APP_BASE_URL=https://...` → restart service |
| IIS 502.3 timeout | Long-running suite run exceeds proxy timeout | Increase `proxy_read_timeout` to `600s` in nginx or set IIS `responseTimeout` |
| Cert renewal fails (Certbot) | Port 80 blocked by firewall | `sudo ufw allow 80` or `firewall-cmd --add-port=80/tcp --permanent` |
| `SSL_ERROR_RX_RECORD_TOO_LONG` | HTTP request sent to HTTPS port | Ensure client uses `https://` not `http://` |
