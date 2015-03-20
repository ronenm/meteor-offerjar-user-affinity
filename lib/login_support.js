// Allow logging-in with an OfferJar Session Token
Accounts.registerLoginHandler(function(loginRequest) {
  if (!loginRequest.offerjar) {
    // Move to next Login Handler
    return undefined;
  };
  
  var partner;
  
  try {
    // PartnerProxy.get uses environment variable when partnerUId is not defined
    partner = OfferJar.PartnerProxy.get(loginRequest.partnerUId);
  } catch(e) {
    return null;
  }
  
  if (!loginRequest.session_token ) {
    // This is an error
    return null;
  }
  
  var user = partner.affiliateBySessionToken(loginRequest.session_token);
  
  //send loggedin user's user id
  return user ? { id: user.id } : null;
  
});

// Allows just linking of a user to a session token
Meteor.methods({
  linkToOfferJar: function(linkRequest) {
    check(linkRequest,{
      session_token: String,
      partnerUId: Match.Optional(String),
      allowSetUser: Match.Optional(String), // 'loggedout', 'anonymous'
      transferAffinity: Match.Optional(Boolean)
    });
    
    var partner = OfferJar.PartnerProxy.get(linkRequest.partnerUId);
    
    if (!this.userId) {
      if (linkRequest.allowSetUser) {
        var user = partner.affiliateBySessionToken(linkRequest.session_token);
        this.setUserId(user._id);
        partner.removeOthersAffiliations(user);
        return;
      } else {
        throw new Meteor.Error("not-logged-in", "You must login to link to OfferJar");
      }
    }

    var affinity_record = partner.sessionTokenToUserAffinity(session_token);
    
    var user = Meteor.users.findOne(this.userId);
    var record = partner.getServiceRecordForUser(user);
    
    if (record && record.token===affinity_token.token) {
      partner.updateUserWithUserAffinity(user,affinity_token);
      partner.removeOthersAffiliations(user);
    } else if (record.anonymous && affinity_token.user && !affinity_token.user.anonymous && linkRequest.allowSetUser==='anonymous') {
      user = partner.findOrCreateUserByUserAffinity(affinity_token);
      this.setUserId(user._id);
      partner.removeOthersAffiliations(user);
    } else {
      var optional_users = partner.findUsersByAffinityToken(affinity_record.token);
      var optional_users_count = optional_users.count();
      if (optional_users_count>0) {
        if (linkRequest.transferAffinity) {
          partner.affiliateUser(user,{affinity_record: affinity_record, force_reload: true});
          if (optional_users_count>0) {
            partner.removeOthersAffiliations(user,record.affinity_token);
          }
        } else {
          user = _.first(optional_users.fetch());
          if (optional_users_count>1) {
            partner.removeOthersAffiliations(user,record.affinity_token);
          }
          if (linkRequest.allowSetUser) { 
            this.setUserId(user._id);
          } else {
            throw new Meteor.Error("mismatch", "Mismatch in user tokens");
          }
        }
      } else {
        partner.affiliateUser(user,{affinity_record: affinity_record, force_reload: true});
      }
    }
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

