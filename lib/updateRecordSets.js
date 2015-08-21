"use strict";

var AWS = require('../lib/aws');
var Promise = require('bluebird');
var _ = require('lodash');
var fs = require('fs');
var moment = require('moment');
var resourceDefinition = require('../lib/resourceDefinition');
var s3location = require('../lib/s3location');

// AWS.config.update({region: 'us-east-1'});
// AWS.config.update({region: 'us-west-1'});
var ec2 = new AWS.EC2();
var route53 = new AWS.Route53();

var findInstances = function (filters) {
    var params = {};
    if (filters && filters.length > 0) {
        params.Filters = filters;
    }
    return new Promise(function (resolve, reject) {
        return ec2.describeInstances(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(_.flatten(_.map(data.Reservations, function (reservation) {
                    return reservation.Instances;
                })));
            }
        });
    });
};

var findInstanceIPs = function (filters, privateIP) {
    return findInstances(filters)
    .then(function (instances) {
        return _.flatten(_.map(instances, function (instance) {
            if (privateIP && instance.PrivateIpAddress) {
                return [instance.PrivateIpAddress];
            } else if (instance.PublicIpAddress) {
                return [instance.PublicIpAddress];
            } else {
                return [];
            }
        }));
    });
};

var IpToResourceRecord = function (ip) {
    return {
        Value: ip
    };
};

var recordSetTemplate = function (recordTemplate, ips) {
    return _.extend(_.defaults({}, recordTemplate, {
    }), {
        ResourceRecords: _.map(ips, IpToResourceRecord)
    });
};

var changeTemplate = function (resourceRecordSet) {
    return {
        Action: 'UPSERT'
        , ResourceRecordSet: resourceRecordSet
    };
};

var goUpdate = function (hostedZoneId, changes, comment) {
    comment = comment || ('Changed at ' +  moment().toISOString());
    console.log('Change record set: ', {
        HostedZoneId: hostedZoneId
        , ChangeBatch: { 
            Changes: changes
            , Comment: 'Changed ' + moment().toISOString() + ' '
        }
    });
    return new Promise(function (resolve, reject) {
        route53.changeResourceRecordSets({
            HostedZoneId: hostedZoneId
            , ChangeBatch: { 
                Changes: changes
                , Comment: 'Changed ' + moment().toISOString() + ' '
            }
        }, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

module.exports = Promise.method(function (params) {
    var getResource;
    if (params.s3Location) {
        getResource = s3location.read(params.s3Location)
            .then(s3location.download)
            .then(resourceDefinition.parse);
    } else if (params.resource) {
        getResource = resourceDefinition.read(params.resource);
    } else {
        throw new Error('updateRecordSets requires s3Location or resource.');
    }

    return getResource
        .then(function (resource) {
            var hostedZone = resource.HostedZone;
            var resources = resource.resources;
            return Promise.map(_.pairs(resources), function (pair) {
                var resourceName = pair[0];
                var resource = pair[1];
                if (!resource.hasOwnProperty('Filters')) {
                    throw new Error('Missing Filters for resource ' + resourceName);
                }
                if (!resource.hasOwnProperty('ResourceRecordSet')) {
                    throw new Error('Missing ResourceRecordSet for resource ' + resourceName);
                }
                return findInstanceIPs(resource.Filters, resource.PrivateIP)
                    .then(function (ips) {
                        return changeTemplate(recordSetTemplate(resource.ResourceRecordSet, ips));
                    });
            })
                .then(function (changes) {
                    return goUpdate(hostedZone, changes);
                });
        });   
});