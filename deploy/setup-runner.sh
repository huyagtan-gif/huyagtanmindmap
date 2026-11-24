#!/usr/bin/env bash
# Installs a GitHub Actions self-hosted runner on the VPS, running as the "deploy" user.
# Run as root AFTER setup-server.sh:
#   sudo bash setup-runner.sh <REGISTRATION_TOKEN>
# Get the token from: GitHub repo → Settings → Actions → Runners → New self-hosted runner (Linux x64).
set -euo pipefail

TOKEN="${1:?Usage: sudo bash setup-runner.sh <REGISTRATION_TOKEN>}"
REPO_URL="https://github.com/huyagtan-gif/huyagtanmindmap"
RUNNER_USER="deploy"
RUNNER_DIR="/home/$RUNNER_USER/actions-runner"

apt-get install -y curl tar jq >/dev/null

VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ ! -f ./config.sh ]; then
  sudo -u "$RUNNER_USER" curl -fsSL -o runner.tgz \
    "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-x64-${VERSION}.tar.gz"
  sudo -u "$RUNNER_USER" tar xzf runner.tgz && rm runner.tgz
  ./bin/installdependencies.sh
fi

sudo -u "$RUNNER_USER" ./config.sh --unattended --replace \
  --url "$REPO_URL" --token "$TOKEN" \
  --name "huyagtan-vps" --labels "huyagtan" --work _work

./svc.sh install "$RUNNER_USER"
./svc.sh start

# Let the deploy job read the app log when a restart fails
echo "$RUNNER_USER ALL=(root) NOPASSWD: /usr/bin/journalctl -u huyagtan *" > /etc/sudoers.d/huyagtan-logs
chmod 440 /etc/sudoers.d/huyagtan-logs

echo "Runner installed. It should show as Idle under Settings → Actions → Runners."
