# Deploying WhatsAppAutomation on Amazon EC2

## 1) Provision instance
- Launch an Ubuntu EC2 instance.
- Open security group ports:
  - `22` (SSH)
  - `80` (HTTP)
  - `443` (HTTPS)

For your current server:
- Region: `eu-north-1`
- Public host: `ec2-13-62-18-39.eu-north-1.compute.amazonaws.com`
- Public IP: `13.62.18.39`

## 2) Install runtime
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm i -g pm2
```

## 3) Deploy app code (first time)
```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
git clone <your-repo-url> /var/www/WhatsAppAutomation
cd /var/www/WhatsAppAutomation
npm ci --omit=dev
```

Create `.env` with production values (Mongo URI, OAuth keys, Paystack keys, session settings, SMTP, Hugging Face values).

## 4) Start with PM2
```bash
cd /var/www/WhatsAppAutomation
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 5) Enable auto-deploy from GitHub (push + merged pull request)
This repo includes `.github/workflows/deploy-ec2.yml`, which SSHs into EC2 and runs `scripts/deploy-on-ec2.sh` on:
- every push to `main`
- every pull request closed as merged into `main`

In your GitHub repo, add these **Actions secrets**:
- `EC2_HOST`: `ec2-13-62-18-39.eu-north-1.compute.amazonaws.com`
- `EC2_USER`: `ubuntu`
- `EC2_SSH_KEY`: private key content for the SSH key that can access your instance (`codeBot.pem` content)
- `EC2_PROJECT_PATH`: `/var/www/WhatsAppAutomation`
- `EC2_BRANCH`: `main`

After saving secrets, any push/merged PR to `main` triggers deployment.

## 6) Configure Nginx reverse proxy
Create `/etc/nginx/sites-available/whatsapp-automation`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 40M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`client_max_body_size` should be equal to or higher than your app upload limit (`MAX_REQUEST_BODY_MB` in `.env`, default `40`).

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/whatsapp-automation /etc/nginx/sites-enabled/whatsapp-automation
sudo nginx -t
sudo systemctl reload nginx
```

## 7) Enable HTTPS
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 8) Operational checks
```bash
pm2 status
pm2 logs whatsapp-automation --lines 100
curl -I http://127.0.0.1:3000
```

## 9) Troubleshooting: `502 Bad Gateway` on your domain

If you see this in browser devtools:

- `GET https://your-domain.com/ 502 (Bad Gateway)`
- plus a CSP warning like: `Content Security Policy ... script-src ... unsafe-eval`

Treat these as **two separate signals**:

1. `502 Bad Gateway` means Nginx (or another proxy) cannot reach your Node app.
2. The CSP `unsafe-eval` warning is usually from scripts/extensions trying to run on the proxy error page. It is often **not** the root cause of the 502.

Use this checklist on the server:

```bash
# 1) Is the Node process up?
pm2 status
pm2 logs whatsapp-automation --lines 200

# 2) Is the app reachable directly (bypassing Nginx)?
curl -i http://127.0.0.1:3000/

# 3) Is Nginx healthy and pointing to the right upstream?
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo tail -n 200 /var/log/nginx/error.log
```

If `curl http://127.0.0.1:3000/` fails, fix the app/PM2 process first. If that succeeds but your domain still returns 502, fix Nginx upstream config/reload.
