const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths where Kubernetes auto-mounts ServiceAccount credentials into every pod
const TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const NAMESPACE_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

function readServiceAccountFiles() {
  try {
    const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    const ca = fs.readFileSync(CA_PATH);
    const namespace = fs.readFileSync(NAMESPACE_PATH, 'utf8').trim();
    return { token, ca, namespace };
  } catch (err) {
    // Falls through when running locally outside a cluster (e.g. `node server.js` on your laptop)
    return null;
  }
}

function requestPodsFromApi(sa) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'kubernetes.default.svc',
        path: `/api/v1/namespaces/${sa.namespace}/pods`,
        method: 'GET',
        ca: sa.ca,
        headers: { Authorization: `Bearer ${sa.token}` }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Kubernetes API returned ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse Kubernetes API response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchPods() {
  const sa = readServiceAccountFiles();

  // Local dev fallback: return fake data so the frontend is buildable without a live cluster
  if (!sa) {
    return mockPods();
  }

  // Node 18's built-in fetch (undici) does not reliably support the `agent`
  // option for custom CA certs, which silently broke the in-cluster API call.
  // Using the native https module directly avoids that incompatibility.
  const data = await requestPodsFromApi(sa);

  return data.items.map(pod => ({
    name: pod.metadata.name,
    phase: pod.status.phase,                              // Pending, Running, Succeeded, Failed, Unknown
    ready: (pod.status.containerStatuses || []).every(c => c.ready),
    restarts: (pod.status.containerStatuses || []).reduce((sum, c) => sum + c.restartCount, 0),
    startedAt: pod.status.startTime || null,
    node: pod.spec.nodeName || null
  }));
}

function mockPods() {
  // Used only when running outside a cluster, so the frontend has something to render during local dev
  const phases = ['Running', 'Running', 'Running', 'Pending'];
  return Array.from({ length: 5 }, (_, i) => ({
    name: `mock-pod-${i}`,
    phase: phases[i % phases.length],
    ready: i % 4 !== 3,
    restarts: i === 2 ? 2 : 0,
    startedAt: new Date().toISOString(),
    node: 'local-dev'
  }));
}

app.get('/api/pods', async (req, res) => {
  try {
    const pods = await fetchPods();
    res.json({ pods, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Failed to fetch pods:', err.message);
    res.status(500).json({ error: 'Failed to reach Kubernetes API' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`ClusterBloom listening on port ${PORT}`);
});