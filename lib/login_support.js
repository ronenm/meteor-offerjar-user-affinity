// Allow logging-in with an OfferJar Session Token
Accounts.registerLoginHandler(function(loginRequest) {
  if (!loginRequest.offerjar) {
    // Move to next Login Handler
    return undefined;
  };
  
  var offerjarRec = loginRequest.offerjar;
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
  
  var user = partner.affiliateBySessionToken(offerjarRec.session_token);
  
  //send loggedin user's user id
  return user ? { id: user.id } : null;
  
});

// Allows just linking of a user to a session token
Meteor.methods({
  linkToOfferJar: function(linkRequest) {
    check(linkRequest,{
      session_token: String,
      partnerUId: Match.Optional(String),
      allowSetUser: Match.Optional(Boolean),
      transferAffinity: Match.Optional(Boolean)
    });
    
    var partner = OfferJar.PartnerProxy.get(linkRequest.partnerUId);
    
    if (!this.userId) {
      if (linkRequest.allowSetUser) {
        var user = partner.affiliateBySessionToken(linkRequest.session_token);
        this.setUserId(user._id);
      } else {
        throw new Meteor.Error("not-logged-in", "You must login to link to OfferJar");
      }
    }

    var affinity_record = partner.sessionTokenToUserAffinity(session_token);
    
    var user = Meteor.users.findOne(this.userId);
    var record = partner.getServiceRecordForUser(user);
    
    if (record && record.affinity_token==affinity_token.token) {
      partner.removeOthersAffiliations(user,record.affinity_token);
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