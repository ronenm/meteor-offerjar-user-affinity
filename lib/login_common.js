// Arguments can be:
//   partnerUId, session_token, callback
//     or
//   session_token, callback
Meteor.loginWithOfferjarSessionToken = function() {
  var callback;
  var last_arg = arguments.legnth-1;
  
  if (_.isFunction(arguments[last_arg])) {
    callback = arguments[last_arg];
    last_arg--;
  }
  var loginRequest = {offerjar: true, session_token: arguments[last_arg]};
  if (last_arg>0) {
    loginRequest.partnerUId = arguments[0];
  }
  
  // Send the login request
  Accounts.callLoginMethod({
    methodArguments: [loginRequest],
    userCallback: callback
  });
};

// [partnerUId], session_token, [options], callback
// options:
//   transferAffinity: In case the affinity token belongs to other user, move it to the currenct use
//   allowSetUser: if there is no current use, set the current use to the one linked to the session token,
//                  if there is a current use but the affinity belongs to other, change the current user to the
//                  new one UNLESS transferAffinity is set (which has higher priority)
Meteor.linkToOfferJarSessionToken = function() {
  var callback;
  var last_arg = arguments.legnth-1;
  var linkRequest;
  
  if (_.isFunction(arguments[last_arg])) {
    callback = arguments[last_arg];
    last_arg--;
  }
  if (_.isObject(arguments[last_arg])) {
    linkRequest = _.clone(arguments[last_arg]);
    last_arg--;
  } else {
    linkRequest = {};
  }
  linkRequest.session_token = arguments[last_arg];
  if (last_arg>0) {
    linkRequest.partnerUId = arguments[0];
  }
  
  Meteor.call('linkToOfferJar', linkRequest, callback);
  
}

OfferJar.usersInfo = new Mongo.Collection('offerjar.users_info');