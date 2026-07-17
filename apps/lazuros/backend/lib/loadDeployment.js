'use strict';
// loadDeployment.js — read + schema-check the deployment config (the composability
// seam). The config is the ONLY place hardware-specific facts live: model tags,
// inference backends, WoL MACs, tier escalation. Code reads it; code never hardcodes
// it. A self-hoster with different hardware ships a different file — zero code change.
//
// Mounted (not baked) into the image as /app/deployment.json; the path is given by
// LAZUROS_DEPLOYMENT_CONFIG so the same Docker image runs any deployment.

const fs = require('fs');

function loadDeploymentConfig(path = process.env.LAZUROS_DEPLOYMENT_CONFIG) {
  if (!path) throw new Error('LAZUROS_DEPLOYMENT_CONFIG not set — copy deployment.example.json and point at it (see .env.example)');
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  validateDeploymentConfig(raw); // schema check — fail fast on a malformed config
  return raw;
}

function validateDeploymentConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('deployment config: must be an object');
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error('deployment config: tiers must be a non-empty array');
  }
  if (!cfg.computeBackends || typeof cfg.computeBackends !== 'object') {
    throw new Error('deployment config: computeBackends must be an object');
  }
  for (const tier of cfg.tiers) {
    if (typeof tier.id !== 'number') {
      throw new Error(`deployment config: tier ${JSON.stringify(tier.id)} id must be a number`);
    }
    if (!cfg.computeBackends[tier.computeBackend]) {
      throw new Error(`deployment config: tier ${tier.id} references unknown computeBackend "${tier.computeBackend}"`);
    }
  }
}

module.exports = { loadDeploymentConfig, validateDeploymentConfig };
