import './styles/main.scss';

const inViewport = require('in-viewport');
const { Proteus } = require('proteus-js-client');
const { Single } = require('rsocket-flowable');
const { RankingServiceServer } = require('./proto/service_rsocket_pb');
const { RankingResponse } = require('./proto/service_pb');

const Marvel = {

  requestQueue: [],
  handlingRequest: false,

  init() {

    $('#hits .ais-hits').empty();
    this.addMessage('ais-hits', "Waiting for Ranking Request...");
    const url = "ws://localhost:8101/";
    const proteus = Proteus.create({
      setup: {
          group: 'voxxed.demo.ranking',
          accessKey: 9007199254740991,
          accessToken: 'kTBDVtfRBO4tHOnZzSyY5ym2kfY=',
      },
      transport: {
          url,
      }
    });

    proteus.addService('io.rsocket.voxxed.demo.RankingService', new RankingServiceServer(this));

    proteus._connect().subscribe({
      onComplete: function onComplete(connection) {
          console.log("connected")
      },
      onError: function onError(err) {
          console.log(err)
      },
      onSubscribe: function onSubscribe(cancel) {
          /*not sure we would ever cancel*/
      }
    });
  },

    //Very hacky, currently just assuming this is for the one and only ais-hits class
  addMessage(clazz, message) {
    var ul = document.getElementsByClassName(clazz)[0];
    var li = document.createElement("li");
    li.appendChild(document.createTextNode(message));
    if(ul.childElementCount >= 10){
        ul.removeChild(ul.childNodes[0]);
    }
    ul.appendChild(li);
  },

  cloudinary(url, options) {
    let baseUrl = 'https://res.cloudinary.com/pixelastic-marvel/image/fetch/';
    let stringOptions = [];

    // Handle common Cloudinary options
    if (options.width) {
      stringOptions.push(`w_${options.width}`);
    }
    if (options.height) {
      stringOptions.push(`h_${options.height}`);
    }
    if (options.quality) {
      stringOptions.push(`q_${options.quality}`);
    }
    if (options.crop) {
      stringOptions.push(`c_${options.crop}`);
    }
    if (options.format) {
      stringOptions.push(`f_${options.format}`);
    }
    if (options.colorize) {
      stringOptions.push(`e_colorize:${options.colorize}`);
    }
    if (options.color) {
      stringOptions.push(`co_rgb:${options.color}`);
    }
    if (options.gravity) {
      stringOptions.push(`g_${options.gravity}`);
    }

    // Fix remote urls
    url = url.replace(/^\/\//, 'http://');


    return `${baseUrl}${stringOptions.join(',')}/${url}`;
  },

  transformItem(data) {
    // Thumbnail
    let thumbnail = _.get(data, 'thumbnail');
    if (thumbnail) {
      thumbnail = Marvel.cloudinary(thumbnail, {
        width: 200,
        quality: 90,
        crop: 'scale',
        format: 'auto'
      });
    } else {
      thumbnail = './img/hit-default.jpg';
    }

    // Background image
    let background = _.get(data, 'background');
    if (background) {
      let backgroundOptions = {
        width: 450,
        quality: 90,
        crop: 'scale',
        format: 'auto'
      };
      background = Marvel.cloudinary(background, backgroundOptions);
    } else {
      background = require('./img/profile-bg-default.gif');
    }

    // Background image for profile
    let backgroundProfile = _.get(data, 'background');
    if (backgroundProfile) {
      let backgroundProfileOptions = {
        width: 600,
        quality: 90,
        crop: 'scale',
        format: 'auto'
      };
      backgroundProfile = Marvel.cloudinary(backgroundProfile, backgroundProfileOptions);
    } else {
      backgroundProfile = require('./img/profile-bg-default.gif');
    }

    // All items are defered loading their images until in viewport, except
    // the 4 first
    let inViewport = false;
    if (Marvel.lazyloadCounter === undefined || Marvel.lazyloadCounter < 4) {
      inViewport = true;
    }
    Marvel.lazyloadCounter++;

    // If the match is not obvious (not in the name of description), we display
    // where it is found
    let matchingAttributes = Marvel.getMatchingAttributes(data);
    let readableMatchingAttributes = [];
    let isFoundInName = _.has(matchingAttributes, 'name');
    let isFoundInDescription = _.has(matchingAttributes, 'description');
    if (!isFoundInName && !isFoundInDescription) {
      // Merging aliases and secret identities
      let hasAliases = _.has(matchingAttributes, 'aliases');
      let hasSecretIdentities = _.has(matchingAttributes, 'secretIdentities');
      if (hasAliases || hasSecretIdentities) {
        matchingAttributes.aliases = _.concat(
          _.get(matchingAttributes, 'aliases', []),
          _.get(matchingAttributes, 'secretIdentities', [])
        );
        delete matchingAttributes.secretIdentities;
      }

      let readableTitles = {
        aliases: 'Also known as',
        authors: 'Authors',
        powers: 'Powers',
        teams: 'Teams'
      };
      _.each(matchingAttributes, (value, key) => {
        if (_.isArray(value)) {
          value = value.join(', ');
        }
        readableMatchingAttributes.push({
          label: readableTitles[key],
          value
        });
      });
    }
    let isMatchingInNotDisplayedAttributes = !_.isEmpty(readableMatchingAttributes);

    let displayData = {
      uuid: data.id,
      name: data.name,
      description: data.description,
      highlightedName: Marvel.getHighlightedValue(data, 'name'),
      highlightedDescription: Marvel.getHighlightedValue(data, 'description'),
      inViewport,
      thumbnail,
      background,
      matchingAttributes: readableMatchingAttributes,
      isMatchingInNotDisplayedAttributes,
      // Used by the profile only
      backgroundProfile,
      urls: data.urls,
      teams: data.teams,
      powers: data.powers,
      species: data.species,
      authors: data.authors
    };

    return {
      ...displayData,
      json: JSON.stringify(displayData)
    };
  },
  getMatchingAttributes(data) {
    let highlightedResults = data._highlightResult;
    if (!highlightedResults) {
      return {};
    }
    let matchingAttributes = {};
    _.each(highlightedResults, (highlightValue, attributeName) => {
      // Matching in a string attribute
      if (_.isObject(highlightValue) && highlightValue.matchLevel === 'full') {
        matchingAttributes[attributeName] = highlightValue.value;
        return;
      }
      // Matching in an array
      if (_.isArray(highlightValue)) {
        matchingAttributes[attributeName] = _.compact(_.map(highlightValue, (matchValue) => {
          if (matchValue.matchLevel === 'none') {
            return null;
          }
          return matchValue.value;
        }));
      }
    });

    return _.omitBy(matchingAttributes, _.isEmpty);
  },
  getHighlightedValue(object, property) {
    if (!_.has(object, `_highlightResult.${property}.value`)) {
      return object[property];
    }
    return object._highlightResult[property].value;
  },
  // Enable lazyloading of images below the fold
  onRender() {
    let hits = $('.hit');
    function onVisible(hit) {
      $(hit).addClass('hit__inViewport');
    }
    _.each(hits, (hit) => {
      inViewport(hit, {offset: 50}, onVisible);
    });
  },
  rank(rankingRequest) {
    return new Single(subscriber => {
        subscriber.onSubscribe(); // fix
        if (this.handlingRequest) {
            this.requestQueue.push([rankingRequest, subscriber]);
        } else {
            $('#hits .ais-hits').empty();
            this.handlingRequest = true;
            this.handleRankingRequest(rankingRequest, subscriber);
        }
    });
  },
  handleRankingRequest(rankingRequest, subscriber){
    let data = rankingRequest.toObject().recordsList;
    Marvel.lazyloadCounter = 0;
    let hits = $('#hits .ais-hits');
    let hitTemplate = $('#hitTemplate').html();
    let emptyTemplate = $('#noResultsTemplate').html();
    let compiledTemplate = _.template(hitTemplate.trim());

    _.forEach(data, (element) => {
        let html = compiledTemplate(Marvel.transformItem(element)).trim();
        let $html = $($.parseHTML(html));
        $html.click(() => {
            let resp = new RankingResponse();
            resp.setId(element.id);
            subscriber.onComplete(resp);
            hits.empty();
            const nextRequest = this.requestQueue.shift();
            if(nextRequest){
              this.handleRankingRequest(nextRequest[0], nextRequest[1]); //stored reqest/sub pair
            } else {
              this.addMessage('ais-hits', "Waiting for Ranking Request...");
              this.handlingRequest = false;
            }
        });
        hits.append($html);
    });
    this.onRender();
  }

};

Marvel.init();

export default Marvel;
