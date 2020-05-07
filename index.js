const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const http = require('http');
const { execSync } = require('child_process');
const passport = require('passport');
const LdapStrategy = require('passport-ldapauth');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const port = 8080;

app.use(cookieParser('secret'));
app.use(
  session({
    cookie: { maxAge: 60000 },
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET,
    store: new FileStore({}),
  }),
);
app.use(flash());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());
app.use(passport.session());

app.set('views', '.');
app.set('view engine', 'ejs');

passport.use(
  new LdapStrategy({
    server: {
      url: process.env.LDAP_URL,
      bindDN: process.env.LDAP_BIND_DN,
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS,
      searchBase: process.env.LDAP_SEARCH_BASE,
      searchFilter: process.env.LDAP_SEARCH_FILTER,
    },
  }),
);

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

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

const isAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }

  return res.redirect('/');
};

app.get('//', (req, res) => res.render('index', { title: 'Login', message: req.flash('error'), loginPage: true }));
app.get('/databases', isAuth, (req, res) => {
  let items = [];
  ['mysql', 'postgresql', 'mongodb'].forEach((type) => {
    items = fetchDatabases(type, items);
  });
  items = mergeDcWithCephPvc(items);

  return res.render('index', {
    title: 'Databases',
    alert: 'An item is marked as backup only if the DC name is equal to the PVC name',
    items,
    logged: true,
  });
});

app.get('/nfs', isAuth, (req, res) => {
  let items = fetchNfs(false);
  items = fetchNfs(true, items);
  return res.render('index', { title: 'NFS', items });
});

app.post(
  '/login',
  passport.authenticate('ldapauth', {
    successRedirect: '/databases',
    failureRedirect: '/',
    failureFlash: true,
  }),
);

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

app.use('*', (req, res) => res.status(404).send('NOT FOUND !'));

server.listen(port, () => {
  console.log(`Serveur ready on port ${port}`);
});
