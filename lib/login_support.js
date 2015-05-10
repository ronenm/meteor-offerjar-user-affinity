// Local collection
var temporaryTokenCollection = new Mongo.Collection('OfferJarTemporaryTokens');

function setTemporaryToken(userId) {
  var token = temporaryTokenCollection.insert({userId: userId});
  console.log("Create temporary token: ",token);
  // The token is being automatically removed after one minute
  Meteor.setTimeout(function() {
    console.log("Remove temporary token: ",token);
    temporaryTokenCollection.remove(token);
  },60000);
  return token;
}

Meteor.startup(function() {
  // Avoid login by causing server to restart
  temporaryTokenCollection.remove({});
});

// Allow logging-in with an OfferJar Session Token
Accounts.registerLoginHandler("OfferJar",function(loginRequest) {
  if (!loginRequest.offerjar) {
    // Move to next Login Handler
    return undefined;
  };
  
  var userId = null;
  
  if (loginRequest.temporary_token) {
    console.log("Login with temporary token: ",loginRequest.temporary_token);
    var tokenDoc = temporaryTokenCollection.findOne(loginRequest.temporary_token);
    console.log("Token authenticated!:",tokenDoc);
    userId = tokenDoc ? tokenDoc.userId : null;
  } else {
    var partner;
    
    try {
      // PartnerProxy.get uses environment variable when partnerUId is not defined
      partner = OfferJar.PartnerProxy.get(loginRequest.partnerUId);
    } catch(e) {
      return Meteor.Error("Unknown Partner","OfferJar Authentication error");
    }
    
    if (!loginRequest.session_token ) {
      // This is an error
      return Meteor.Error("Missing token","OfferJar Authentication error");
    }
    
    var user = partner.affiliateBySessionToken(loginRequest.session_token);
    
    //send loggedin user's user id
    userId = user ? user._id : null;
  }
  
  if (_.isNull(userId)) {
    return Meteor.Error("Wrong token","OfferJar Authentication error");
  }
  
  //creating the token and adding to the user
  var stampedToken = Accounts._generateStampedLoginToken();
  var hashStampedToken = Accounts._hashStampedToken(stampedToken);
  Meteor.users.update(userId, 
    {$push: {'services.resume.loginTokens': hashStampedToken}}
  );
  console.log("Completed login: id=",userId," token=",stampedToken.token);
  return {
    userId: userId,
    stampedLoginToken: stampedToken
  };
});

// Allows just linking of a user to a session token
Meteor.methods({
  linkToOfferJar: function(linkRequest) {
    check(linkRequest,{
      session_token: String,
      partnerUId: Match.Optional(String),
      // 'loggedout', 'anonymous' (if boolean: true => 'loggedout', false => none)
      allowSetUser: Match.Optional(String,Boolean), 
      transferAffinity: Match.Optional(Boolean)
    });
    
    var partner = OfferJar.PartnerProxy.get(linkRequest.partnerUId);
    
    if (!this.userId) {
      if (linkRequest.allowSetUser) {
        var user = partner.affiliateBySessionToken(linkRequest.session_token);
        console.log("Set user: ",user);
        partner.removeOthersAffiliations(user);
        return setTemporaryToken(user._id);
      } else {
        throw new Meteor.Error("not-logged-in", "You must login to link to OfferJar");
      }
    }

    var affinity_record = partner.sessionTokenToUserAffinity(linkRequest.session_token);
    
    var user = Meteor.users.findOne(this.userId);
    var record = partner.getServiceRecordForUser(user);
    var tempToken = 'STAY';
    
    if (record && record.token===affinity_record.token) {
      partner.updateUserWithUserAffinity(user,affinity_record);
      partner.removeOthersAffiliations(user);
    } else if (record.anonymous && affinity_record.user && !affinity_record.user.anonymous && linkRequest.allowSetUser==='anonymous') {
      user = partner.findOrCreateUserByUserAffinity(affinity_record);
      tempToken = setTemporaryToken(user._id);
      partner.removeOthersAffiliations(user);
    } else {
      var optional_users = partner.findUsersByAffinityToken(affinity_record.token);
      var optional_users_count = optional_users.count();
      if (optional_users_count>0) {
        if (linkRequest.transferAffinity) {
          partner.affiliateUser(user,{affinity_record: affinity_record, force_reload: true});
          if (optional_users_count>0) {
            partner.removeOthersAffiliations(user,record.token);
          }
        } else {
          user = _.first(optional_users.fetch());
          if (optional_users_count>1) {
            partner.removeOthersAffiliations(user,record.token);
          }
          if (linkRequest.allowSetUser) { 
            tempToken = setTemporaryToken(user._id);
          } else {
            throw new Meteor.Error("mismatch", "Mismatch in user tokens");
          }
        }
      } else {
        partner.affiliateUser(user,{affinity_record: affinity_record, force_reload: true});
      }
    }
    return(tempToken);
  }
});

// At this stage we only publish whether the user is anonymous or not
// It is possible that in the future we will publish additional info to the user
Meteor.publish('offerjar.users_info',function(partnerUID) {
  var self = this;
  check(partnerUID, Match.optional(String));
  var partner = PartnerProxy.get(partnerUID);
  var currentUser = Meteor.users.findOne(self.userId);
  var record = partner.getServiceRecordForUser(currentUser);
  
  var handle = Meteor.users.find(self.userId).observe({
    changed: function(newDocument, oldDocument) {
      var newRecord = partner.getServiceRecordForUser(newDocument);
      if (!(newRecord && _.has(newRecord,'anonymous'))) {
        return;
      }
      if (!record && newRecord || !_.has(record,'anonymous') || record.anonymous!==newRecord.anonymous) {
        self.changed('offerjar.users',newDocument._id,{anonymous: newRecord.anonymous});
        record = newRecord;
      }
    }
  });
  
  var anonymous = !(record && _.has(record,'anonymous')) ? true : record.anonymous;
  self.added('offerjar.users_info',self.userId,{anonymous: anonymous});
  self.ready();

  // Stop observing the cursor when client unsubs.
  // Stopping a subscription automatically takes
  // care of sending the client any removed messages.
  self.onStop(function () {
    handle.stop();
  });
});

