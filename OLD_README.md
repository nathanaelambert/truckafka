# Truckmafia
Truckmafia is a City Dispatch Platform serving the Southern Ontario logistics corridor, enclosed by: 
North: Barrie, ON; East: Peterborough, ON & Pickering, ON; West: London, ON; South: Niagara Falls, ON. 
All timestamp are recorded using Eastern Daylight Time (Toronto time).
It focuses on Roadstar, a truck carrier with a fleet of 100 trucks and 300 trailers, with two terminal hubs. 
One in London, ON and one in Milton, ON. Truckmafia's main product is a Dispatcher webapp dashboard. 
It allows dispatchers to monitor the fleet, driver's HOS, traffic conditions and ETA's, view past routes, while simulating ways to efficiently assign future loads to specific trucks and trailers. 

# USER WORKFLOWS
System must work with multiple users using the app at the same time and synchronize state.

## Administrator (desktop, stable connection)
*Manages the fleet of vehicles, the drivers. Useful for development, testing, and demo purposes*
- Create/view/update/delete truck
- Create/view/update/delete trailer
- Create/view/delete driver
- Simulate fake driver activity (behaves like a driver)
- delete everything from db (popup confirmantion)

## Dispatcher (desktop, stable connection)
*Negotiates loads with brokers. Creates hauls by assigning a load to a driver, truck, and trailer. *
- Create a load in the system by filling up a form. (Create location with geofence).
- Modify location, geofence, or load.
- View all loads in a table.
- View all available drivers, and their hos info in a table. 
- View all available trucks, and their status in a table.
- View all available trailers in a table.
- submit a haul order
- follow a haul
- view road status 
- view road events
- create road event
- view past hauls
- gets notified of driver events
### Locally
*Test haul options, simulate scenario in the future, test, validate, without submitting orders*
- create hauls
- split a haul (stop at terminal hub. Two options: abandon/switch trailer or unload trailer. Loading/unloading a trialer addds one hour delay between the end of first haul and the second haul).
- view state in the future
- add fake future events
- simulate state
- submit hauls once happy
- undo last change
### Automatic features
*Actions that happen automatically in the background, or on external trigger not necessarly the user*
- road_segment expected time computation: every road_event limits segment's maxspeed, truck historical average time (computed separetly for each weekday hour segment (tuesday09:00-10:00)), if not further data : estimated_time(road_segment) = road_segment.length_m*1000 / 0.8*road_segment.maxspeed_km
- compute best itinerary at given time for created hauls (A* using road expected time, and only using segments if maxweight < load.weight + fixed weight for trailer and truck)
- Display itinerary when haul is selected

## Truck Driver (mobile, unstable connection)
*Drives the truck, picks up and deliver loads, track their hours of service*
- View hauls assigned to him
- receive notification if haul is modified
- view itinerary, live navigation
- log status (ON_DUTY, OFF_DUTY, DRIVING, SLEEPER)
- view road status
- view road events 
- manually report road event
### Automatic features
*Actions that happen automatically in the background, or on external trigger not necessarly the user* 
- map matching: map device GPS location to road_segment, monitor measured speed
- compute expected speed based on road segment and historical road_events
- publish current location update (trigger: every 2s)
- publish road event: prompt driver to select event type: traffic jam, construction...) (trigger: average speed for the last minute is significantly smaller than expected speed)
- publish haul event: prompt driver to send a message to dispatch (trigger: detect significant deviation from itineray)

# Apps and User Interface
## Webapp 
There is one webapp. It is meant for dispatchers and admins.
There is navbar at the top with three pages: monitor, plan, admin

### Monitor
*All splits can be readjusted by clicking and draging the border to resize (within reasonable limits of min size for content)*
Horizontal split (top (80% height): main display, bottom (20% height: timeline))
#### Main display:
vertical split (left: (75% width): map, right: (25% width): control panel)
##### Map
Big OSM map with satellite layer toggle option, and pins depending on display options. 
##### Control panel
horizontal split (top part (1/3 height): display info, bottom part (2/3 height): view options)
###### display info
Displays info about selected element (truck, road segment, haul, driver, load, trailer, location, geofence).
Can be edited by cliking edit icon next to a field. Confirm pop up if change is significant (changing a haul's dropoff location will re-route the driver and send an order).
Every reference is clickable and becomes the selected object (clicking on the load id ina haul displays the load)
back and forth arrows to come back to previously selected element (web navigation style)
every timestamp displayed comes with a button to set view time to that specific time (see timeline)
###### View options
vertical scrollable multiple collapsible lists of display options: 
Option to show/hide certain things on map:
- truck (an svg arrow moving on the road based on it's position)
- locations/geofence
- road segments (color for estimated speed)
- haul (shows road segments with actual speed for the past, shows road segments in a neutral light color for the itinerary (future), show pins for start and end, shows start time on start pin click, shows end time on end pin (or ETA if end time is in the future), shows info widget on segments with events that was reported by driver)
##### Timeline
Bottom of the screen showing current date and time, with an option to change the time (this time corresponds to the view time, it is possible to view things from the past or future), the map must update the position of vehicles according to the history (for passt) or the predictions (for future). Road segment status, are also updated based on time selected. 
Visual indicator showing if time is past, future or live.
When time is changed, many computations must be done: a driver who is assigned to a haul will be displayed in the future with updated hours of service remaining

### Plan
Vertical split view (left (50% width): draft area, right (50% width): real data)
#### Draft area
vertical scrollable multiple collapsible lists:
- events
- hauls
- loads
the 3 sections are simililar:
they are imnitially empty. There is an option to create(delete/update drafts of hauls, events, loads. Drafts can be activated or not with a button. An active drafts behaves like a regular element: it is taken into account in the monitor view, itinerary calculations...

#### real data
vertical scrollable multiple collapsible lists:
- events
- hauls
- loads
The 3 sections are similar. They display their elements (like monitor.control_panel.display_info would). everytime something is selected, the element is selected and the interface switches to the monitor interface

### Admin
The admin page has different sections that can be scrolled. Some of the functionalities are for testing purposes.
#### Fleet Summary
- Fleet summary (number of trucks per status): total trucks, total trailers, total drivers, number of drivers in service, number drivers off duty,  number of trucks on the move, number of trucks at london hub, number of trucks at milton hub, same with trailers.
#### Fleet control
- Fleet controls add/remove/update truck, driver, trailer
#### loads
- future loads overview
- create new loads buttons
#### Simulate Driver (test and debug)
- simulated drivers: simulate a truck driver client app: 
- drive automatically along the itinerary assigned
- set speed
- log hos status
- Generate haul or road events
- simulate driver being offline. 
-

## Mobile app
Interface: 
A card showing information about the current/incoming haul: load, truck, and trailer info).



a discreet slider with 3 states from left to right: OFF-DUTY, ON-DUTY-NOT-DRIVING, DRIVING
This is the status and user can update their status by sliding the button. 
This is done in a way so that it is not possible to go from off-duty to driving without being in the off-duty-not-driving state. 




# REQUIREMENT
## functional requirements
## non-functional requirements
low latency
high availability
unstable connection assumed for drivers

# DATA MODEL
Mandatory fields marked with "*"

## load
- id* (uuid) [PK]
- number* (varchar)
- weight (int)
- commodity (varchar)
- pickup_location_id* [FK: location.id]
- pickup_phone* (varchar)
- pickup_after* (timestamp)
- pickup_before* (timestamp)
- dropoff_location_id* [FK: location.id]
- dropoff_phone* (varchar)
- dropoff_after* (timestamp)
- dropoff_before* (timestamp)
- multi_stop_id (uuid) [FK: load.id]
- is_hazmat (bool)
- detention_rate (int)
- rate_km (float)
- note (text)

## haul
- id* (uuid) [PK]
- load_id* [FK: load.id]
- driver_id* [FK: driver.id]
- truck_id* [FK: truck.id]
- trailer_id* [FK: trailer.id]
- started_at* (timestamp)
- ended_at* (timestamp)
- status (varchar)

## truck
- id* (uuid) [PK]
- number (varchar(4))
- is_safe_to_drive* (bool)
- note (text)
- location_id [FK: location.id]

## trailer
- id* (uuid) [PK]
- number* (varchar(6))
- status (varchar)
- location_id [FK: location.id]
- is_safe_to_drive* (bool)
- note (text)

## driver
- id* (uuid) [PK]
- name (varchar)
- email (varchar)
- cycle_id* (smallint)
- home_location_id [FK: location.id]
- day_start_hour* (time) 
- overtime* (smallint)

## hours_of_service
- driver_id* [FK: driver.id]
- cycle_start (timestamp)
- shift_start (timestamp)
- remaining_cycle (int)
- remaining_shift (int) 
- remaining_drive (int)
- until_break (int)

## user
- id* (uuid) [PK]
- user_name (varchar)
- name (varchar)
- password_hash* (varchar)
- role* (varchar)
- driver_id [FK: driver.id]

## location
- id* (uuid) [PK]
- name* (varchar)
- position* (geography point)
- geofence_id [FK: geofence.id]

## geofence
- id* (uuid) [PK]
- boundary* (geography polygon)

## road_segment
- id* (uuid) [PK]
- geometry (LINESTRING)
- maxspeed_km (SMALLINT)
- maxweight_kg (INT)
- length_m (INT)
- highway_type (varchar)
- from_node [FK: road_node.id]
- to_node [FK: road_node.id]

## road_node
- id* [PK]
- location (geography point)
- osm_node_id (bigint)
- osm_version (integer)

## road_segment_traversal
- id* (uuid) [PK]
- haul_id* [FK: haul.id]
- road_segment_id* [FK: road_segment.id]
- sequence* (INTEGER)

## road_event
- id* (uuid) [PK]
- road_segment_id* [FK: road_segment.id]
- maxspeed_km (SMALLINT)
- maxweight_kg (INT)
- note (TEXT)
- start_at* (timestamp)
- end_at* (timestamp)


# Architecture
Micro-service application with API gateway, rest api, websocket, event sourcing in backend (kafka), postgresl db with postgis, open street map api.

# Details
## loads
There is three types of loads that needs to be handled.
1. Pick load from company-A, drop it to company-B. (might be split into two loads: company-A to terminal Hubs (miton or london) and terminal Hub to company-B. 
2. Load from one of the two terminal hubs to company-C. (result of a previous split, or load was brought by OTR driver. 
3. Load from company-D to one of the terminal hub. (for split or load will be picked up by OTR driver later).
Truckmafia doesn't monitor OTR drivers, they use their own truck and trailer. 

## hours of service
*Record Of Duty Status according to Transport Canada Commercial Vehicle Drivers Hours of Service Regulations (South of 60°N), MTO Commercial Driver's Handbook, and CCMTA ELD standards.*

driver.status can be: DRIVING, ON_DUTY_NOT_DRIVING, OFF_DUTY

### hours_of_service
- driver_id* [FK: driver.id]
- next_bed_time (timestamp)
- remaining_cycle_h (int)
- slept_today (bool)
- remaining_on_duty_h (int)
- breaks_remaining(int)
- break_started (timestamp)

### driver
- id* (uuid) [PK]
- name (varchar)
- email (varchar)
- home_location_id [FK: location.id]
- cycle_id* (smallint) # '1' or '2'
- overtime (smallint) # usually 10h for cycle 1
- day_start_hour* (time) #00:00 most of the time

### notation
#### <(is before)
is an operator that compares two timestamps and returns a boolean
#### next(time)
returns the nearest future timestamp (based on current time) that matches the given time (for example: if the current timestamp is monday@14:02:34, next(10:30) will return tuesday@10:30:00).
#### previous(time) 
returns the nearest past timestamp (based on current time) that matches the given time (for example: if the current timestamp is monday@14:02:34, previous(10:30) will return monday@10:30:00).
 
### Can drive
driver can drive iff current_time <(is before) next_bed_time

### Event: new shift start (enter ON-DUTY or DRIVING after 8h+ off-duty)
set `slept_today` = (previous(`day_start_hour`) <(is before) current time - 8h)
if `slept_today` :
    Set `next_bed_time` to current_time + 13h
else:
    Set `next_bed_time` to min(currenttime + 13h, next(`day_start_hour`) - (8h+2h+1h))
set `breaks_remaing`= 4
set `remaining_on_duty_h` = 1h

### Event: Cycle start

### Event: slept


### Event: cycle reset

### Status: ON_DUTY_NOT_DRIVING
for every second that elapses:
    if (`remaining_on_duty_h` > 0):
        decrement `remaining_on_duty_h` by 1s
        increment `next_bed_time` by 1s

### Status: DRIVING


### Status: OFF_DUTY
When entering state: 
    set `break_start` = current time
When exiting state:
    break_duration = current time - `break_start`
    if (break_duration >= 8h): 
        throw event(new shift start)
        return
    if (5h <= break duration < 8h):
        warn driver that they need to extend their break by (8h - break_duration) to complete a mandatory sleep and make them confirm(go ON_DUTY) or cancel(extend OFF_DUTY)
    if (`breaks_remaining` > 0 ):
        number_of_breaks = min(0.5h * `breaks_remaining`, floor(break_duration / 0.5h)))
        lost_time = break_duration % 0.5h
        if (`breaks_remaining` - number_of_breaks > 0 and lost_time > 10min):
            warn driver that they need to extend their break by (30min - lost_time) to complete a mandatory break and make them confirm(go ON_DUTY) or cancel(extend OFF_DUTY)
        increment `next_bed_time` by 30min * number_of_breaks
        decrement `breaks_remaining` by number_of_breaks
    else:
        notify driver that they have taken all mandatory breaks for the day
        


### Violation
Driver is working beyond what the law allows.
It is critical to avoid this.
Notify driver.
Notify dispatch.

### Overtime
Driver is working beyond what their contract plans. They get paid 1.5×regular_pay.
It is good if dispatch can avoid this.
Notify driver.
Notify dispatch.


### Cycle
- if driver.cycle_type=1 : remaining_cycle resets to 70h if driver is OFF-DUTY for 36 consecutive hours.
- if driver.cycle_type=2 :remaining_cycle resets to 120h if driver is OFF-DUTY for 72 consecutive hours.
- when driver logs his first ON-DUTY_NOT_DRIVING or DRIVING event with a full cycle (70h for type 1), last_cycle_start is recorded, last_shift_start is recorded and remaining_cycle and remaining_shift start ticking down.
- remaining_shift resets to 14h, daily at driver.day_start_hour 
- remaining_shift resets if driver is OFF-DUTY or SLEEPER for 8 consecutive hours: 

### regulation
• 13-Hour Driving Limit: Drivers can drive a maximum of 13 hours within a work shift.
• 14-Hour On-Duty Limit: Drivers cannot drive after accumulating 14 hours of total on-duty time (driving + non-driving work like loading, unloading, or waiting at docks).
• 16-Hour Elapsed Window: No driving is allowed after 16 hours have elapsed since the end of the last 8+ consecutive hour rest break.

• Cycle Limits: Carriers operate under Cycle 1 (70 hours on-duty in 7 days) or Cycle 2
(120 hours on-duty in 14 days).
- breaks are at least 30min


Every day the driver must sleep 8h consecutively + take at least 4 breaks of 30min

### event: new day
### event: finish sleep (start working after 8+h rest)
next_bed_time timestamp is set to current + 16

you cannot go to bed later than yesterday ( you can go sooner)

