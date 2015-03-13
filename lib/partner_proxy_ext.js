var PartnerProxy = OfferJar.PartnerProxy;
var proto = PartnerProxy.prototype;

_.extend(PartnerProxy.prototype,{
  // Trying to get best performance
  updateUserWithUserAffinity: function(user,user_affinity) {
    // We try to perform inline updates except for the case where we will increase the size of the document anyways
    var use_full_override = false;
    var updates = { $set: {} };
    var update_counter = 0;
    
    if (_.isObject(user_affinity.user) ) {
      var idx = 0;
      for(idx = 0; idx<user.emails.length; idx++) {
        if (user.emails[idx].address===user_affinity.user.email_address) {
          break;
        }
      }
      
      if (idx<user.emails.length) {
        if (_.has(user.emails[idx],'anonymous') ) {
            if ( user.emails[idx].anonymous!=user_affinity.user.anonymous ) {
              updates.$set["emails." + idx + ".anonymous"] = user_affinity.user.anonymous;
              update_counter++;
            }
        } else {
          use_full_override = true;
        }
        user.emails[idx].anonymous = user_affinity.user.anonymous;
      } else {
        use_full_override = true;
        update_counter++;
        user.emails.push({ address: user_affinity.user.email_address, verified: false, anonymous:  user_affinity.user.anonymous});
        if (!user_affinity.user.anonymous) {
          user.emails = _.reject(user.emails,_.matcher({anonymous: true}));
        }
      }
    }
    
    var record = this.getServiceRecordForUser(user);
    if (record) {
      if (!use_full_override && _.has(record,'token') && _.has(record,'exposure_level')) {
        updates.$set["services.offerjar." + this.uid + ".token"] = user_affinity.token;
        updates.$set["services.offerjar." + this.uid + ".exposure_level"] = user_affinity.exposure_level;
      }
      if (record.token != user_affinity.token) {
        record.token = user_affinity.token;
        update_counter++;
      }
      if (!_.isEqual(record.exposure_level,user_affinity.exposure_level)) {
        record.exposure_level = user_affinity.exposure_level;
        update_counter++;
        use_full_override = true;
      }
    } else {
      update_counter++;
      use_full_override = true;
      if (!user.services) user.services = {};
      if (!user.services.offerjar) user.services.offerjar = {};
      user.services.offerjar[this.uid] = _.pick(user_affinity,'token','exposure_level');
    }
    
    if (use_full_override) {
      updates = user;
    }
    if (update_counter>0) {
      Meteor.users.update(user._id,updates);
    }
    return this.getServiceRecordForUser(user);
  },
  // Create an affiliation
  // user should be a Meteor user record
  // options may include:
  //    use_email: The email address or the index in the emails array of the user record
  //               to be used
  //    force_reload: Request for the record even when we already have the token
  //    user_affinity: Avoid recalling OfferJar for user affinity
  affiliateUser: function(user,options) {
    if (!options) {
      options = {};
    }
  
    if (!options.force_reload) {
      var record = this.getServiceRecordForUser(user);
      if (record) {
        return record;
      }
    }
    
    // Meteor accounts support more than one email address
    // The caller can provide the email address or the index of the email address
    // otherwise we always take the first email address in the list
    var use_email = options.use_email;
    if (use_email) {
      if (_.isNumber(use_email)) {
        use_email = user.emails[use_email].address;
      }
    } else {
      use_email = _.first(user.emails).address;
    }
    
    var affinity_rec = _.isObject(options.user_affinity) ? options : this.createAffinity({
      email_address: use_email,
      name: user.profile.name
    }).data;
    return this.updateUserWithUserAffinity(user,affinity_rec.user_affinity);  
  },
  removeAffiliation: function(user,token) {
    if (user.services.offerjar[this.uid].token==token) {
      var update = { $unset: {} };
      update.$unset["services.offerjar." + this.uid] = "";
      delete user.services.offerjar[this.uid];
      Meteor.users.update(user._id,update);
    }
  },
  // This function will remove same token affiliation from other users
  removeOthersAffiliations: function(user,token) {
    var qry = { $and: [ { _id: { $ne: user._id} }, {} ] };
    qry.$and[1]['services.offerjar.'+this.uid+'.token'] = token;  
    var update = { $unset: {} };
    update.$unset["services.offerjar." + this.uid] = "";
    Meteor.users.update(qry,update);
  },
  // Convert a session token into an user affinity token
  sessionTokenToUserAffinity: function(session_token) {
    if (!this.session_token_cache) {
      this.session_token_cache = {};
    }
    
    if (!this.session_token_cache[session_token]) {
      var affinity_rec = this.createAffinity({token: session_token}).data;
      this.session_token_cache[session_token] = affinity_rec.user_affinity;    
    }
    return this.session_token_cache[session_token];
  },
  // Find a user only by user_affinity token
  findUsersByAffinityToken: function(token) {
    qry = {};
    qry['services.offerjar.'+this.uid+'.token'] = token;
    return Meteor.users.find(qry, {sort: { createdAt: -1 }});
  },
  findOrCreateUserByUserAffinity: function(user_affinity) {
    var qry = {};
    qry['services.offerjar.'+this.uid+'.token'] = user_affinity.token;
    if (user_affinity.email_address) {
      qry = {
        $or: [ qry, { emails: { $elemMatch: { address: user_affinity.email_address }}} ]
      }
    }
    var user = _.first(Meteor.users.find(qry, {sort: { createdAt: -1 }, limit: 1}).fetch()); // Take the latest one if there are more than one
    
    if (user) {
      this.updateUserWithUserAffinity(user,user_affinity);
      return user;
    } else {
      var user_aff_user = user_affinity.user;
      var username = user_aff_user.name ? user_aff_user.name.replace(/\s+/g,"_") :
                      "anonymous-" + Random.id();
      var email_address = user_aff_user.email_address || username + "@offerjar.com";
      var offerjar_rec = {};
      offerjar_rec[this.uid] = _.pick(user_affinity,'token', 'exposure_level');
      var user_id = Meteor.users.insert({
        username: username,
        emails: [ { address: email_address, verified: false, anonymous: user_aff_user.anonymous } ],
        profile: {
          name: user_affinity.name,
          anonymous: user_aff_user.anonymous
        },
        services: {
          offerjar: offerjar_rec
        }
      });
      return Meteor.users.findOne(user_id);
    }
  },
  createAnonymousUser: function() {
    // The third way of creating an affinity which creates a new anonymous user
    // in the OfferJar server
    var affinity_record = this.createAffinity().data;
    return this.findOrCreateUserByUserAffinity(affinity_record.user_affinity);
  },
  // Find or create a user based on a session token
  affiliateBySessionToken: function(session_token) {
    var user_affinity = this.sessionTokenToUserAffinity(session_token);
    if (user_affinity && user_affinity.token) {
      return this.findOrCreateUserByUserAffinity(user_affinity);
    } else {
      throw new Meteor.Error("offerjar:WrongSessionToken","Illegal access!");
    }
  },
  getServiceRecordForUser: function(user) {
    return user.services && user.services.offerjar && _.has(user.services.offerjar,this.uid) && user.services.offerjar[this.uid];
  },
  // Use this to create a session token to refer a user to other partner service of
  // OfferJar while keeping user privacy according to OfferJar's need-to-know policy
  createSessionToken: function(user) {
    record = this.affiliateUser(user); // It will just return the service record if exists
    return this.getAffinitySession(record.token).data;
  }
});

// The partner registry
PartnerProxy.registry = {};

PartnerProxy.get = function(uid,token) {
  if (!uid) {
    uid = process.env.INKOMERCE_PARTNER_UID; 
  }
  
  if (!uid) {
    throw new Meteor.Error("offerjar:missingPartnerUID", "Internal error!");
  }
  
  if (_.has(PartnerProxy.registry,uid) && _.isObject(PartnerProxy.registry[uid])) {
    return PartnerProxy.registry[uid]
  }
  if (!token) {
    token = process.env.INKOMERCE_PARTNER_TOKEN;
  }
  if (!token) {
    throw new Meteor.Error("offerjar:missingPartnerToken", "Internal error!");
  }
  
  var partner = new PartnerProxy(token);
  partner.connect(uid);
  return PartnerProxy.registry[uid] = partner;
}

