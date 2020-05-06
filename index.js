const express = require('express');
const http = require('http');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);

const port = 8080;

app.set('views', '.');
app.set('view engine', 'ejs');

const oc = (command) => JSON.parse(execSync(`oc ${command}`).toString()).items;

const fetchDatabases = (type, accumulator = []) => {
  const result = oc(`get dc -l backup=${type} --all-namespaces -o json`);

  return result.reduce((acc, curr) => {
    const namespace = curr.metadata.namespace;
    const name = curr.metadata.name;
    const available = Number(curr.status.availableReplicas) > 0;

    const namespaceIndex = acc.findIndex((item) => item.name === namespace);

    const item = {
      name,
      badges: [
        {
          name: type,
          color: 'secondary',
        },
        {
          name: available ? 'Available' : 'Not available',
          color: available ? 'success' : 'danger',
        },
      ],
      color: 'blank',
    };

    // If namespace doesn't exists
    if (namespaceIndex === -1) {
      acc.push({
        name: namespace,
        items: [item],
      });
    } else {
      acc[namespaceIndex].items.push(item);
    }

    return acc;
  }, accumulator);
};

const reducePvc = (result, backup, accumulator = []) =>
  result
    .reduce((acc, curr) => {
      const namespace = curr.metadata.namespace;
      const name = curr.metadata.name;
      const size = curr.status.capacity ? curr.status.capacity.storage : '?';
      const phase = curr.status.phase;

      const namespaceIndex = acc.findIndex((item) => item.name === namespace);

      const item = {
        name: name,
        color: backup ? 'success' : 'danger',
        badges: [
          {
            name: size,
            color: 'secondary',
          },
          {
            name: phase,
            color: phase === 'Bound' ? 'success' : 'danger',
          },
        ],
      };

      // If namespace doesn't exists
      if (namespaceIndex === -1) {
        acc.push({
          name: namespace,
          items: [item],
        });
      } else {
        acc[namespaceIndex].items.push(item);
      }

      return acc;
    }, accumulator)
    .sort((a, b) => (a.name < b.name ? -1 : 1));

// backup: if true, selects ONLY pvc which are backuped. If false, selects ONLY pvc which are NOT backuped
const fetchNfs = (backup, accumulator = []) => {
  const selector = backup ? 'backup=nfs' : 'backup!=nfs';
  const result = oc(`get pvc --all-namespaces -o json -l ${selector}`);

  return reducePvc(
    result.filter((item) => item.metadata.annotations['volume.beta.kubernetes.io/storage-class'] === 'nfs-proxmox-vm'),
    backup,
    accumulator,
  );
};

const mergeDcWithCephPvc = (dcs) => {
  const result = oc(`get pvc --all-namespaces -o json`);

  const pvcs = reducePvc(
    result.filter((item) => item.metadata.annotations['volume.beta.kubernetes.io/storage-class'] === 'ceph'),
    false,
  ).map((namespace) => ({
    ...namespace,
    items: namespace.items.map((item) => ({
      ...item,
      badges: [
        ...item.badges,
        (() => {
          const dcNamespace = dcs.find((dcNamespace) => dcNamespace.name === namespace.name);

          if (!dcNamespace) {
            return null;
          }

          const dcItem = dcNamespace.items.find((dcItem) => dcItem.name === item.name);

          if (!dcItem) {
            return null;
          }

          // A bit ugly to get the dc available badge
          return dcItem.badges.find((badge) => badge.name === 'Available' || badge.name === 'Not available');
        })(),
      ].filter((item) => item !== null),
      color: (() => {
        const dcNamespace = dcs.find((dcNamespace) => dcNamespace.name === namespace.name);

        if (!dcNamespace) {
          return false;
        }
        return dcNamespace.items.findIndex((dcItem) => dcItem.name === item.name) !== -1;
      })()
        ? 'success'
        : 'danger',
    })),
  }));

  return pvcs;
};

app.get('//', (req, res) => res.redirect('/databases'));
app.get('/databases', (req, res) => {
  let items = [];
  ['mysql', 'postgresql', 'mongodb'].forEach((type) => {
    items = fetchDatabases(type, items);
  });
  items = mergeDcWithCephPvc(items);

  return res.render('index', {
    title: 'Databases',
    alert: 'An item is marked as backup only if the DC name is equal to the PVC name',
    items,
  });
});

app.get('/nfs', (req, res) => {
  let items = fetchNfs(false);
  items = fetchNfs(true, items);
  return res.render('index', { title: 'NFS', items });
});

app.use('*', (req, res) => res.status(404).send('NOT FOUND !'));

server.listen(port, () => {
  console.log(`Serveur ready on port ${port}`);
});
