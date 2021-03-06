// Copyright 2010 and onwards Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Script that runs in the context of the browser action popup.
 *
 * @author manas@google.com (Manas Tungare)
 */

/**
 * Namespace for browser action functionality.
 */
var browseraction = {};

/**
 * @type {string}
 * @const
 * @private
 */
browseraction.QUICK_ADD_API_URL_ = 'https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/quickAdd';

browseraction.CAL_START = 0;
browseraction.CAL_END = 23;
browseraction.HOUR_HEIGHT = 60;

/**
 * Initializes UI elements in the browser action popup.
 */
browseraction.initialize = function() {
  chrome.extension.getBackgroundPage().background.log('browseraction.initialize()');
  utils.startAnalytics_();
  _gaq.push(['_trackEvent', 'Popup', 'Shown']);
  browseraction.fillMessages_();
  browseraction.installButtonClickHandlers_();
  browseraction.showLoginMessageIfNotAuthenticated_();
  browseraction.loadCalendarsIntoQuickAdd_();
  browseraction.listenForRequests_();
  versioning.checkVersion();
 
  chrome.extension.sendMessage({method: 'events.feed.get'},
      browseraction.showEventsFromFeed_);
   
};

browseraction.showCurrentTimeNeedle_ = function() {
  var calStart = moment().startOf('day').hours(browseraction.CAL_START);
  var calEnd = moment().startOf('day').hours(browseraction.CAL_END);
  var totalDisplayDuration = calEnd.hour() - calStart.hour();

  var now = moment();
  var needle = $('<div>').addClass('needle');
  needle.appendTo($('#event-list'));
  $('<div>').addClass('needle-bg').appendTo(needle);

  var updateNeedlePosition = function() {
      needle.css({'top': now.diff(calStart, 'hours', true) * browseraction.HOUR_HEIGHT});
      $("#calendar-view").scrollTop($("#calendar-view").scrollTop() + $(".needle").position().top - browseraction.HOUR_HEIGHT);
  };
  updateNeedlePosition();
  setInterval(updateNeedlePosition, 5 * 1000);
}


/**
 * Fills i18n versions of messages from the Chrome API into DOM objects.
 * @private
 */
browseraction.fillMessages_ = function() {
  // Initialize language for Moment.js.
  moment.lang('en');
  moment.lang(window.navigator.language);
  if (moment.lang() != window.navigator.language) {
    moment.lang(window.navigator.language.substring(0, 2));
  }

  // Load internationalized messages.
  $('.i18n').each(function() {
    var i18nText = chrome.i18n.getMessage($(this).attr('id').toString());
    if (!i18nText) {
      chrome.extension.getBackgroundPage().background.log(
          'Error getting string for: ', $(this).attr('id').toString());
      return;
    }

    if ($(this).prop('tagName') == 'IMG') {
      $(this).attr({'title': i18nText});
    } else {
      $(this).text(i18nText);
    }
  });

  $('[data-href="calendar_ui_url"]').attr('href', constants.CALENDAR_UI_URL);
  $('#quick-add-event-title').attr({
    'placeholder': chrome.i18n.getMessage('event_title_placeholder'
  )});
};


/** @private */
browseraction.loadCalendarsIntoQuickAdd_ = function() {
  chrome.extension.getBackgroundPage().background.log('browseraction.loadCalendarsIntoQuickAdd_()');
  chrome.storage.local.get('calendars', function(storage) {
    if (chrome.runtime.lastError) {
      background.log('Error retrieving calendars:', chrome.runtime.lastError);
    }

    if (storage['calendars']) {
      var calendars = storage['calendars'];
      var dropDown = $('#quick-add-calendar-list');
      for (var calendarId in calendars) {
        var calendar = calendars[calendarId];
        if (calendar.editable) {
          dropDown.append($('<option>', {
            value: calendar.id,
            text: calendar.title
          }));
        }
      }
    }
  });
};


/** @private */
browseraction.installButtonClickHandlers_ = function() {
  $('#authorization_required').on('click', function() {
    $('#authorization_required').text(chrome.i18n.getMessage('authorization_in_progress'));
    chrome.extension.sendMessage({method: 'authtoken.update'});
  });

  $('#show_quick_add').on('click', function() {
    _gaq.push(['_trackEvent', 'Quick Add', 'Toggled']);
    $('#quick-add').slideToggle(200);
    $('#quick-add-event-title').focus();
  });

  $('#hide_calendar').on('click', function() {
    $('#calendar-events').toggle();
  });

  $('#sync_now').on('click', function() {
    _gaq.push(['_trackEvent', 'Popup', 'Manual Refresh']);
    chrome.extension.sendMessage({method: 'events.feed.fetch'},
        browseraction.showEventsFromFeed_);
  });

  $('#show_options').on('click', function() {
    _gaq.push(['_trackEvent', 'Options', 'Shown']);
    chrome.tabs.create({'url': 'options.html'});
  });

  $('#quick_add_button').on('click', function() {
    _gaq.push(['_trackEvent', 'Quick Add', 'Event Created']);
    browseraction.createQuickAddEvent_($('#quick-add-event-title').val().toString(),
        $('#quick-add-calendar-list').val());
    $('#quick-add-event-title').val('');  // Remove the existing text from the field.
  });
};


/**
 * Checks if we're logged in and either shows or hides a message asking
 * the user to login.
 * @private
 */
browseraction.showLoginMessageIfNotAuthenticated_ = function() {
  chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
    if (chrome.runtime.lastError || !authToken) {
      _gaq.push(['_trackEvent', 'getAuthToken', 'Failed', chrome.runtime.lastError.message]);
      chrome.extension.getBackgroundPage().background.log('getAuthToken',
          chrome.runtime.lastError.message);
      browseraction.stopSpinnerRightNow();
      $('#error').show();
      $('#action-bar').hide();
      $('#calendar-events').hide();
    } else {
      _gaq.push(['_trackEvent', 'getAuthToken', 'OK']);
      $('#error').hide();
      $('#action-bar').show();
      $('#calendar-events').show();
    }
  });
};


/**
 * Listens for incoming requests from other pages of this extension and calls
 * the appropriate (local) functions.
 * @private
 */
browseraction.listenForRequests_ = function() {
  chrome.extension.onMessage.addListener(function(request, sender, opt_callback) {
    switch(request.method) {
      case 'ui.refresh':
        chrome.extension.sendMessage({method: 'events.feed.get'},
            browseraction.showEventsFromFeed_);
        break;

      case 'sync-icon.spinning.start':
        browseraction.startSpinner();
        break;

      case 'sync-icon.spinning.stop':
        browseraction.stopSpinner();
        break;
    }
  });
};


browseraction.startSpinner = function() {
  $('#sync_now').addClass('spinning');
};

browseraction.stopSpinner = function() {
  $('#sync_now').one('animationiteration webkitAnimationIteration', function() {
    $(this).removeClass('spinning');
  });
};

browseraction.stopSpinnerRightNow = function() {
  $('#sync_now').removeClass('spinning');
};

/** @private */
browseraction.createQuickAddEvent_ = function(text, calendarId) {
  var quickAddUrl = browseraction.QUICK_ADD_API_URL_.replace('{calendarId}', encodeURIComponent(calendarId))
      + '?text=' + encodeURIComponent(text);
  chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
    if (chrome.runtime.lastError || !authToken) {
      chrome.extension.getBackgroundPage().background.log('getAuthToken', chrome.runtime.lastError.message);
      _gaq.push(['_trackEvent', 'getAuthToken', 'Failed', chrome.runtime.lastError.message]);
      return;
    }
    _gaq.push(['_trackEvent', 'getAuthToken', 'OK']);
    _gaq.push(['_trackEvent', 'QuickAdd', 'Add']);

    browseraction.startSpinner();
    $.ajax(quickAddUrl, {
      type: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken
      },
      success: function(response) {
        browseraction.stopSpinner();
        chrome.extension.sendMessage({method: 'events.feed.fetch'});
      },
      error: function(response) {
        browseraction.stopSpinner();
        $('#info_bar').text(chrome.i18n.getMessage('error_saving_new_event')).slideDown();
        window.setTimeout(function() {
          $('#info_bar').slideUp();
        }, constants.INFO_BAR_DISMISS_TIMEOUT_MS);
        _gaq.push(['_trackEvent', 'QuickAdd', 'Error', response.statusText]);
        chrome.extension.getBackgroundPage().background.log('Error adding Quick Add event', response.statusText);
        if (response.status === 401) {
          chrome.identity.removeCachedAuthToken({ 'token': authToken }, function() {});
        }
      }
    });
    $('#quick-add').slideUp(200);
  });
};


/**
 * Retrieves events from the calendar feed, sorted by start time, and displays
 * them in the browser action popup.
 * @param {Array} events The events to display.
 * @private
 */
browseraction.showEventsFromFeed_ = function(events) {
  chrome.extension.getBackgroundPage().background.log('browseraction.showEventsFromFeed_()');
  //$('#calendar-events').empty();

  chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
    if (chrome.runtime.lastError || !authToken) {
      _gaq.push(['_trackEvent', 'getAuthToken', 'Failed', chrome.runtime.lastError.message]);
      chrome.extension.getBackgroundPage().background.log('getAuthToken',
          chrome.runtime.lastError.message);
      $('#error').show();
      $('#action-bar').hide();
      $('#calendar-events').hide();
    } else {
      _gaq.push(['_trackEvent', 'getAuthToken', 'OK']);
      $('#error').hide();
      $('#action-bar').show();
      $('#calendar-events').show();
      browseraction.showCurrentTimeNeedle_();

    }
  });

  // Insert a date header for Today as the first item in the list. Any ongoing
  // multi-day events (i.e., started last week, ends next week) will be shown
  // under today's date header, not under the date it started.
  var headerDate = moment().hours(0).minutes(0).seconds(0).millisecond(0);
  $('<div>').addClass('date-header')
      .text(headerDate.format('dddd, MMMM D'))
      .appendTo($('#calendar-events'));

  var eventList = $('<div>');
  eventList.attr('id', 'event-list');
  eventList.addClass('event-list');
  eventList.appendTo($('#calendar-events'));

  var eventListBG = $('<div>');
  eventListBG.addClass('event-list-bg');
  eventListBG.appendTo($('#event-list'));

  for (var i = 0; i < (browseraction.CAL_END - browseraction.CAL_START); i++ ){
    $('<div>').addClass('hour-tick').appendTo(eventListBG);
  }

  var eventDivs = [];
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var start = utils.fromIso8601(event.start);
    var end = utils.fromIso8601(event.end);

    // Insert a new date header if the date of this event is not the same as
    // that of the previous event.
    var startDate = start.clone().hours(0).minutes(0).seconds(0);
    if (startDate.diff(headerDate, 'hours') > 23) {
      headerDate = startDate;
      $('<div>').addClass('date-header')
          .text(headerDate.format('dddd, MMMM D'))
          .appendTo($('#event-list'));
    }

    var eventDiv = browseraction.createEventDiv_(event);
    eventDiv.appendTo($('#event-list'));
    eventDivs.push(eventDiv);
  }

  for (var i = 0; i < events.length; i++) {
      var prev = events[i-1];
      var curr = events[i];
      
      if (prev != undefined && !prev.allday) {
          var start = utils.fromIso8601(curr.start);
          var end = utils.fromIso8601(prev.end);
          if (end.isAfter(start)) {
             eventDivs[i-1].css({'width': '80%'});
             
             var alignment = (eventDivs[i-1].position().left == 0) ? 'right' : 'left';
             eventDivs[i].css('width', '80%');
             eventDivs[i].css(alignment, 0);
          }
      }
          
  }


};

browseraction.hexToRGB = function(hex) {
    var r = parseInt(hex.substring(1,3), 16);
    var g = parseInt(hex.substring(3,5), 16);
    var b = parseInt(hex.substring(5,7), 16);
    return {'r':r, 'g':g, 'b': b};
}


/**
 * Creates a <div> that renders a detected event or a fetched event.
 * @param {CalendarEvent} event The calendar event.
 * @return {!jQuery} The rendered 'Add to Calendar' button.
 * @private
 */
browseraction.createEventDiv_ = function(event) {
  var start = utils.fromIso8601(event.start);
  var end = utils.fromIso8601(event.end);
  var now = moment().valueOf();

  var calStart = moment().startOf('day').hours(browseraction.CAL_START);
  var calEnd = moment().startOf('day').hours(browseraction.CAL_END);
  var totalDisplayDuration = calEnd.hour() - calStart.hour();

  var eventDiv = /** @type {jQuery} */ ($('<div>')
      .addClass('event')
      .attr({'data-url': event.gcal_url}));

  if (!start) {  // Some events detected via microformats are malformed.
    return eventDiv;
  }

  var isDetectedEvent = !event.feed;
  var isHappeningNow = start.valueOf() < now && end.valueOf() >= now;
  var spansMultipleDays = (end.diff(start, 'seconds') > 86400);
  if (event.allday) {
    eventDiv.addClass('all-day');
    eventDiv.css('top', 0);
  } else {
    // set height and offset from day start
    var duration = end.diff(start, 'hours', true);
    eventDiv.height(duration * browseraction.HOUR_HEIGHT * 0.95);

    eventDiv.css({'top': start.diff(calStart, 'hours', true) * browseraction.HOUR_HEIGHT + "px"});
  }
  if (isDetectedEvent) {
    eventDiv.addClass('detected-event');
  }
  eventDiv.on('click', function() {
    chrome.tabs.create({'url': $(this).attr('data-url')});
  });

  var timeFormat = options.get('format24HourTime') ? 'HH:mm' : 'h:mma';
  var dateTimeFormat = event.allday ? 'MMM D, YYYY' :
      (isDetectedEvent ? 'MMM D, YYYY ' + timeFormat : timeFormat);
  var startTimeDiv = $('<div>').addClass('start-time');
  if (isDetectedEvent) {
    startTimeDiv.append(
      $('<img>').attr({
          'width': 19,
          'height': 19,
          'src': chrome.extension.getURL('icons/calendar_add_38.png'),
          'alt': chrome.i18n.getMessage('add_to_google_calendar')
        })
      );
  } else {
    startTimeDiv.css({'background-color': event.feed.backgroundColor});
  }
  if (!event.allday && !isDetectedEvent) {
  }
  startTimeDiv.appendTo(eventDiv);

  var eventDetails = $('<div>')
      .addClass('event-details')
      .appendTo(eventDiv);

  var rgb = browseraction.hexToRGB(event.feed.backgroundColor);
  eventDetails.css({'background-color': 'rgba(' + rgb['r'] + ', ' + rgb['g'] + ', ' + rgb['b'] + ', 0.4',
                    'color': 'rgb(' + (rgb['r'] - 100) + ', ' + (rgb['g'] - 100) + ', ' + (rgb['b'] - 100) + ')'});

  /*
  if (event.hangout_url) {
    $('<a>').attr({
      'href': event.hangout_url,
      'target': '_blank'
    }).append($('<img>').addClass('video-call-icon').attr({
      'src': chrome.extension.getURL('icons/ic_action_video.png')
    })).appendTo(eventDetails);

  } else if (event.location) {
    $('<a>').attr({
      'href': 'https://maps.google.com?q=' + encodeURIComponent(event.location),
      'target': '_blank'
    }).append($('<img>').addClass('location-icon').attr({
      'src': chrome.extension.getURL('icons/ic_action_place.png')
    })).appendTo(eventDetails);
  }
  */

  // The location icon goes before the title because it floats right.
  var eventTitle = $('<div>').addClass('event-title').text(event.title);
  if (event.responseStatus == constants.EVENT_STATUS_DECLINED) {
    eventTitle.addClass('declined');
  }
  eventTitle.appendTo(eventDetails);

  $('<div>').addClass('event-start-time').text(start.format(dateTimeFormat)).appendTo(eventDetails);


  if (event.allday && spansMultipleDays || isDetectedEvent) {
    $('<div>')
        .addClass('start-and-end-times')
        .append(start.format(dateTimeFormat) + ' — ' + end.format(dateTimeFormat))
        .appendTo(eventDetails);
  }
  return eventDiv;
};


/**
 * When the popup is loaded, fetch the events in this tab from the
 * background page, set up the appropriate layout, etc.
 */
window.addEventListener('load', function() {
  browseraction.initialize();
}, false);
