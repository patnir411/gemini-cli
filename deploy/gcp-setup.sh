#!/usr/bin/env bash
# Gemini Mobile API - GCP VM Setup Script
#
# This script automates the setup of a GCP Compute Engine VM
# for running the Gemini Mobile API backend.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - A GCP project selected (gcloud config set project YOUR_PROJECT)
#
# Usage:
#   chmod +x gcp-setup.sh
#   ./gcp-setup.sh

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project)}"
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE_NAME="${INSTANCE_NAME:-gemini-mobile-backend}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-4}"  # 4 vCPU, 16GB RAM

echo "=== Gemini Mobile API - GCP Setup ==="
echo "Project:  ${PROJECT_ID}"
echo "Zone:     ${ZONE}"
echo "Instance: ${INSTANCE_NAME}"
echo "Machine:  ${MACHINE_TYPE}"
echo ""

# Step 1: Create firewall rules
echo "[1/4] Creating firewall rules..."
gcloud compute firewall-rules create allow-gemini-api-https \
  --project="${PROJECT_ID}" \
  --allow=tcp:80,tcp:443 \
  --target-tags=gemini-api \
  --source-ranges=0.0.0.0/0 \
  --description="Allow HTTP/HTTPS for Gemini Mobile API" \
  2>/dev/null || echo "  Firewall rule already exists, skipping."

# Step 2: Create the VM
echo "[2/4] Creating Compute Engine VM..."
gcloud compute instances create "${INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --zone="${ZONE}" \
  --machine-type="${MACHINE_TYPE}" \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --tags=gemini-api \
  --metadata=startup-script='#!/bin/bash
    set -e
    # Install Docker
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu
    # Install Docker Compose
    apt-get install -y docker-compose-plugin
    # Install Node.js 20 (for local dev)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs git
    echo "Setup complete!"
  ' \
  2>/dev/null || echo "  VM already exists. Use --force to recreate."

# Step 3: Wait for VM to be ready
echo "[3/4] Waiting for VM to be ready..."
sleep 10
gcloud compute ssh "${INSTANCE_NAME}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --command="echo 'VM is accessible!'" \
  2>/dev/null || echo "  VM not yet ready, try SSH manually in a few minutes."

# Step 4: Print next steps
EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE_NAME}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || echo "PENDING")

echo ""
echo "=== Setup Complete ==="
echo ""
echo "VM External IP: ${EXTERNAL_IP}"
echo ""
echo "Next steps:"
echo "  1. SSH into the VM:"
echo "     gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE}"
echo ""
echo "  2. Clone the repo and set up:"
echo "     git clone https://github.com/google-gemini/gemini-cli.git"
echo "     cd gemini-cli/deploy"
echo "     cp .env.example .env"
echo "     # Edit .env with your API keys"
echo ""
echo "  3. Start the server:"
echo "     docker compose up -d"
echo ""
echo "  4. Point your domain DNS A record to: ${EXTERNAL_IP}"
echo "     Then update DOMAIN in .env and restart:"
echo "     docker compose down && docker compose up -d"
echo ""
echo "  5. Test the API:"
echo "     curl https://${EXTERNAL_IP}/health -k"
echo ""
