// This file is loaded via --require BEFORE any ES module imports resolve.
// It overrides the local ISP DNS which doesn't support MongoDB Atlas SRV records.
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
