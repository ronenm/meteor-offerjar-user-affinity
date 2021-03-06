Package.describe({
  name: 'ronenm:offerjar-user-affinity',
  version: '0.1.3',
  // Brief, one-line summary of the package.
  summary: 'Support session token login and/or link of user account to offerjar account',
  // URL to the Git repository containing the source code for this package.
  git: 'https://github.com/ronenm/meteor-offerjar-user-affinity.git',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.3.1');
  api.use('ronenm:offerjar-api@1.0.0');
  api.use("underscore");
  api.use("accounts-base");
  api.use("mongo");
  api.use("minimongo");
  api.addFiles('lib/partner_proxy_ext.js','server');
  api.addFiles('lib/login_support.js','server');
  api.addFiles('lib/login_common.js');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('ronenm:offerjar-user-affinity');
  api.addFiles('ronenm:offerjar-user-affinity-tests.js');
});
