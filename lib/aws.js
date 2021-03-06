

var AWS = module.exports = require('aws-sdk');
AWS.config.update({
    region: 'us-west-1'
    , apiVersions: {
        ec2: '2015-04-15'
        , iam: '2010-05-08'
        , lambda: '2015-03-31'
        , route53: '2013-04-01'
        , s3: '2006-03-01'
    }
});

