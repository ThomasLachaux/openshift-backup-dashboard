# Openshift Backup Viewer

A micro dashboard to see which pvc are backup and which are not

![Capture](images/1.jpg?raw=true)

## Installation

Required

- Node.js
- Yarn

```
cp .env.example .env # Fill it with your environment variables
yarn
yarn dev
```

## Service account creation

Create the service account

```
echo '{"apiVersion":"v1","kind":"ServiceAccount","metadata":{"name":"openshift-backup-viewer"}}' | oc create -f -
```

Add the permission (it depends on the cluster role installed but you need read on all pvc/dc/pod)

```
oc policy add-cluster-role-to-user <CLUSTER_ROLE> system:serviceaccount:`oc project -q`:openshift-minio-backup
```
