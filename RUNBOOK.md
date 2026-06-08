# Local 24/7 Runbook

This service runs on the local PC inside Ubuntu WSL and exposes webhooks through ngrok.

## Canonical Directory

Use one working directory:

```bash
cd /home/hrd/apps/yandex-market-retailcrm-chats
```

Do not run production from Windows copies under `E:\PROJECTS`.

## Required Runtime Files

These files are local runtime state and must not be deleted:

- `.env`
- `data.json`

`data.json` stores RetailCRM Message Gateway token, channels, and message mappings.

## Start Or Restart

```bash
pm2 start ecosystem.config.js
pm2 save
```

Restart after config or code changes:

```bash
pm2 restart yandex-market-chats
pm2 restart yandex-market-ngrok
```

## Enable Startup After Reboot

Run once:

```bash
pm2 startup
```

PM2 prints a `sudo env ... pm2 startup ...` command. Run that command, then:

```bash
pm2 save
```

## Health Checks

Local service:

```bash
curl http://127.0.0.1:3000/health
```

Public ngrok endpoint:

```bash
curl -I "$BASE_URL/health"
```

Expected public response includes `HTTP/2 200`.

## Ngrok And VPN

If ngrok logs show `ERR_NGROK_9040`, the ngrok agent is not going through the VPN.

Check the current egress IP:

```bash
curl https://ifconfig.me
```

The ngrok agent must not exit through the blocked IP. Route these ngrok agent hosts/IPs through VPN:

```text
connect.ngrok-agent.com
*.ngrok-agent.com
*.ngrok.com
ngrok.com
```

If routing by domain does not work from WSL, resolve and route the current agent IPs:

```bash
nslookup connect.ngrok-agent.com
```

## RetailCRM Red Message Error

When RetailCRM shows "Ошибка взаимодействия с модулем канала":

1. Check ngrok is public:

   ```bash
   curl -I "$BASE_URL/health"
   ```

2. Check whether RetailCRM reached the service:

   ```bash
   curl -s http://127.0.0.1:4040/api/requests/http
   ```

3. Check app logs:

   ```bash
   pm2 logs yandex-market-chats --lines 80 --nostream
   ```

4. If ngrok was offline and then fixed, re-register the module:

   ```bash
   pm2 restart yandex-market-chats
   ```

## Critical Behavior

Yandex Market may accept a message and return only `{ "status": ... }` without `messageId`.
That is still a successful send. The RetailCRM webhook response must not include `error` in that case.
