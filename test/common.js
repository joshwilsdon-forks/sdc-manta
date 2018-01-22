/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * common.js: common code for various tests
 */
var assertplus = require('assert-plus');
var jsprim = require('jsprim');
var services = require('../lib/services');
var sdc = require('../lib/sdc');

/* Public interface */
exports.defaultCommandExecutorArgs = defaultCommandExecutorArgs;
exports.generateFakeBase = generateFakeBase;

function defaultCommandExecutorArgs()
{
	/*
	 * These are the same defaults used in mzParseCommandLine().  They're
	 * repeated here rather than referencing that copy directly to make sure
	 * that changes to that code require that these tests be updated
	 * appropriately.
	 *
	 * The value here is also not necessarily exactly the same object as the
	 * default value in mzParseCommandLine().  For example, we elide
	 * streamStatus because it needs to be checked differently than the
	 * other properties.
	 */
	return ({
	    'amqpHost': null,
	    'amqpPort': 5672,
	    'amqpTimeout': 5000,
	    'amqpLogin': 'guest',
	    'amqpPassword': 'guest',
	    'sdcMantaConfigFile': sdc.sdcMantaConfigPathDefault,

	    'scopeAllZones': false,
	    'scopeComputeNodes': null,
	    'scopeZones': null,
	    'scopeServices': null,
	    'scopeGlobalZones': false,

	    'concurrency': 10,
	    'dryRun': false,

	    'execMode': null,
	    'execTimeout': 60000,
	    'execCommand': null,
	    'execFile': null,
	    'execDirectory': null,
	    'execClobber': null,
	    'bindIp': null,

	    'omitHeader': false,
	    'outputMode': 'text',
	    'outputBatch': true,
	    'multilineMode': 'auto'
	});
}

/*
 * generateFakeBase is used to generate a fake vew of our Manta deployment for
 * testing purposes.
 *
 * It takes a minimal JSON object of the "deployed" services as input and
 * populates a data structure similar to what would be returned when running in
 * a real datacenter. Usually these deployed services are gathered entirely by
 * maAdm using real data from Triton's APIs, but lacking this information we
 * generate data that is close to what Triton would give us.
 *
 * See test/tst.adm.js and test/tst.adm_show.js for examples of the input this
 * function expects. This is the same as what `manta-adm show -js` would output
 * in a functional datacenter. It is assumed that this object is the same for
 * each additional datacenter that is requested.
 *
 * The output of this function is an object that can be passed to
 * maAdm.loadFakeDeployed for use in our test suite.
 *
 * Multiple AZs are supported, and only the first AZ will be populated with VMs,
 * CNs, and Images. The lack of this information is what madm uses to determine
 * if there are other AZs to report on (that is, any AZ that is not the AZ that
 * we're currently running manta-adm from).
 */
function generateFakeBase(fakeDeployed, azCount) {
	assertplus.object(fakeDeployed);
	assertplus.number(azCount);
	assertplus.ok(azCount > 0 && (azCount % 1 === 0),
	    'azCount must be a positive integer');

	var ids, svcids, fakeBase, azNum, cnid, azName, cnUuid, cnHostname,
	    cnIp, svcname, svc, svcid, version, svckey, cfgs;

	ids = {};
	svcids = {};
	fakeBase = {
		'app': { 'name': 'manta' },
		'services': { /* filled in below */ },
		'instances': { /* filled in below */ },
		'vms': { /* filled in below */ },
		'cns': { /* filled in below */ },
		'images': { /* filled in below */ }
	};
	version = jsprim.pluck(fakeDeployed, 'metadata.v') || 1;

	for (azNum = 1; azNum <= azCount; azNum++) {
		for (cnid in fakeDeployed) {
			if (cnid === 'metadata')
				continue;
			if (azCount > 1) {
				azName = 'test-' + azNum.toString();
				cnUuid = azName + '-' + cnid;
			} else {
				azName = 'test';
				cnUuid = cnid;
			}
			cnHostname = cnUuid.toUpperCase();
			cnIp = cnUuid + '.example.com';
			if (azNum == 1) {
				fakeBase['cns'][cnUuid] = {
				    'datacenter': azName,
				    'hostname': cnHostname,
				    'server_uuid': cnUuid,
				    'sysinfo': {
				        'Network Interfaces': {
				            'foo': {
				                'NIC Names': 'admin',
				                'ip4addr': cnIp
				            }
				        }
				    }
				};
				fakeBase['images'] = {
				    'img001': {
				        'version': 'master001'
				    },
				    'img002': {
				        'version': 'master002'
				    },
				    'img003': {
				        'version': 'master003'
				    }
				};
			}

			for (svcname in fakeDeployed[cnid]) {
				if (!svcids[svcname])
					svcids[svcname] = nextId('service');
				svcid = svcids[svcname];
				svc = fakeDeployed[cnid][svcname];
				svckey = services.serviceConfigProperties(
				    svcname, version);

				fakeBase['services'][svcid] = {
					'name': svcname,
					'params': {
					    'networks': [
						'admin',
						'manta'
					    ]
					}
				};

				if (svcname === 'loadbalancer')
					fakeBase['services'][svcid]['params']
					    ['networks'].push('external');
				if (svcname === 'marlin')
					fakeBase['services'][svcid]['params']
					    ['networks'] = [ 'mantanat' ];

				if (version > 1) {
					cfgs = svc;
				} else {
					cfgs = jsprim.flattenObject(
					    svc, svckey.length);
				}
				cfgs.forEach(function (cfg) {
					var nic_tags = null;
					/*
					 * network uuids are assumed to be
					 * nic_tag names in the test suite.
					 */
					if (cfg.hasOwnProperty(
					    ['untrusted_networks'])) {
					    nic_tags = cfg['untrusted_networks']
						.map(function (net) {
							return (net.ipv4_uuid);
						});
					}
					if (nic_tags === null) {
						nic_tags = fakeBase['services']
						    [svcid]['params']
						    ['networks'];
					}
					populateVms({
					    'cnid': cnUuid,
					    'svcid': svcid,
					    'shardid': cfg['shard'] ||
						cfg[svckey.indexOf('SH')] || 1,
					    'imgid': cfg['image_uuid'] ||
						cfg[svckey.indexOf('IMAGE')],
					    'count': cfg['count'] ||
						cfg[cfg.length - 1],
					    'az': azName,
					    'nics': nic_tags
					}, (azNum == 1));
				});
			}
		}
	}

	return (fakeBase);

	function nextId(name)
	{
		var rv;

		if (!ids[name])
			ids[name] = 1;

		rv = ids[name]++;
		if (rv < 10)
			return (name + '00' + rv);
		if (rv < 100)
			return (name + '0' + rv);
		return (name + rv);
	}

	function populateVms(params, masterAz)
	{
		var i, id;
		for (i = 0; i < params['count']; i++) {
			id = nextId('instance');
			if (!fakeBase['instances'][params['svcid']])
				fakeBase['instances'][params['svcid']] = [];
			fakeBase['instances'][params['svcid']].push({
				'uuid': id,
				'params': { 'server_uuid': params['cnid'] },
				'metadata': {
				'SHARD': params['shardid'],
				'DATACENTER': params['az']
				}
			});
			if (masterAz) {
				fakeBase['vms'][id] = {
					'image_uuid': params['imgid'],
					'server_uuid': params['cnid'],
					'nics': []
				};
				params.nics.forEach(function (nic_tag) {
					var nic = {
					    'ip4addr': '0.0.0.0',
					    'network_uuid': nic_tag,
					    'nic_tag': nic_tag
					};
					if (nic_tag == 'external' ||
					    nic_tag == 'mantanat') {
					    nic.primary = true;
					}
					fakeBase['vms'][id]['nics'].push(nic);
				});
			}
		}
	}
}
