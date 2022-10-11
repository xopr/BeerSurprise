///// Helper functions /////
function $( _selector, _parent )
{
    const node = (_parent || document).querySelectorAll( _selector );
    // TODO: implement array like operators in single node
    return node.length === 1 ? node[ 0 ] : node;
}

function intersectObject( target, available )
{
    // Intersect target object keys with available object keys, using the target values
    const kt = Object.keys(target).filter((k) => k in available);

    const result = kt.reduce( (acc, key) => {
        return {...acc, [key]: target[key]};
    }, {});
    return result;
}

const intersectArray = (list1, list2, isUnion = false) => list1.filter( list1Item => isUnion === list2.includes(list1Item) );

const storage = Object.defineProperties({}, {
    username: {
        enumerable: true,
        get: () => localStorage.username || "",
        set: (value) => {
            if ( value )
                localStorage.username = value;
            else
                delete localStorage.username;
        },
    },
    password: {
        enumerable: true,
        set: async (value) => {
            if ( value && storage.username)
                localStorage.passhash = await hash( value, storage.username );
            else
                delete localStorage.passhash;
        },
    },
    passhash: {
        get: () => localStorage.passhash || null,
        enumerable: true,
    },
    groups: {
        enumerable: true,
        get: () => JSON.parse(localStorage.groups || "[]"),
        set: (value) => {
            if (value)
                localStorage.groups = JSON.stringify(value);
            else
                delete localStorage.groups
        },
    },
});

///// Barcode scanner methods /////
async function startScan()
{
    // Detect supported types and filter everything that looks like a product
    const formats = intersectArray(  await BarcodeDetector.getSupportedFormats(), ["ean_8", "ean_13", "ean_13+2", "ean_13+5", "isbn_10", "isbn_13", "isbn_13+2", "isbn_13+5", "upc_a", "upc_e"], true );
    const barcodeDetector = new BarcodeDetector({formats});

    try
    {
        const mediaStream = await navigator.mediaDevices.getUserMedia( {
            video: {facingMode: "environment", torch: true, focusMode: "continuous"}
          } );

        // Create video overlay
        const overlay = document.createElement("div");
        overlay.className = "overlay";

        const closePromise = new Promise( ( resolve, reject ) => {
            const closeButton = overlay.appendChild( document.createElement("button") );
            closeButton.textContent ="close";
            t("close", {textContent:closeButton});

            closeButton.addEventListener( "click", ( _event ) =>
            {
                resolve( null );
            } );
        });

        const videoPromise = new Promise( ( resolve, reject ) => {
            const video = overlay.appendChild( document.createElement("video") );
            video.srcObject = mediaStream;
            video.onplay = resolve;
            video.onerror = reject;
            video.autoplay = true;
        });

        overlay.appendChild( document.createElement("div") ).className = "scanner";

        document.body.appendChild( overlay );

        // https://stackoverflow.com/questions/37848494/is-it-possible-to-control-the-camera-light-on-a-phone-via-a-website
        const track = mediaStream.getVideoTracks()[0];
        // mediaStream.getTracks().forEach(function(track)
        track.applyConstraints({torch: true, focusMode: "continuous"});
        
        // https://developer.chrome.com/blog/chrome-66-deprecations/
        // imageCapture = new ImageCapture(track).setOptions
        try
        {
            await track.applyConstraints({ advanced: [{torch: true, focusMode: "continuous"}]});
        }
        catch (e)
        {
            console.log(e);
        }

        async function detect( videoPromise )
        {
            video = (await videoPromise).target;

            return new Promise( (resolve, reject) => {
                function renderFrame()
                {
                    return barcodeDetector.detect(video);
                }

                (async function renderLoop() {
                    // Note: difference between UPC(A) and EAN: https://www.barcodestalk.com/learn-about-barcodes/resources/what-difference-between-upc-and-ean
                    // UPC: 123456 78910 4
                    // EAN: 0123456 78901 2
                    const barcodes = await renderFrame();

                    if ( !barcodes.length )
                        requestAnimationFrame(renderLoop);
                    else
                        resolve( barcodes[0].rawValue );
                })();
            })
        }

        const scanPromise = detect( videoPromise );
        const barcode = await Promise.race( [scanPromise, closePromise] );

        // Cleanup
        overlay.remove();
        mediaStream.getTracks().forEach(function(track) {
            track.stop();
            });
        return barcode;
    }
    catch ( error )
    {
        if ( error.name === "NotAllowedError" )
            warn( t( "please_enable_camera_permissions", {textContent: $("#warning")}) );
        else
            console.error( error );
        return null;
    }
}

///// Hashing helpers /////

// SHA-512 hash function
async function hash( _data, _salt )
{
    // Don't hash empty data
    if ( !_data )
        return "";
    // Include salt if we got provided by some; this is to prevent dictionary attack.
    // NOTE: if the SALT changes, all stored passwords will be rendered useless (use versioning for new salts)
    const SALT = "BEERSURPRISE";
    const data = _data + ( _salt ? SALT + _salt : "" );

    const hash = await crypto.subtle.digest( "SHA-512", new TextEncoder().encode( data ) );
    return encode64( hash );
}

// Base64 encode of arraybuffer
function encode64( _buffer )
{
    return btoa( new Uint8Array( _buffer ).reduce( (s, b) => s + String.fromCharCode( b ), "" ) );
}

///// State helpers /////
function loggedin( _responseData )
{
    const state = _responseData.state === STATE.CHEERS;
    const register = $("#register");
    const value = state ? "change_pw" : "register";
    register.dataset.value = value;
    t( value, {value:register});

    $("#login").disabled = !!state;
    $("#newgroup").style.display = state ? "block" : "none";

    if ( _responseData.state === STATE.CHEERS )
    {
        // Success: store passhash and username
        storage.username = $( "#username" ).value;
        g_passhash = storage.passhash;
        
        mergeGroupData( _responseData.group, location.hash && location.hash.slice( 1 ).split( "/" ))
    }
    else
    {
        warn( decodeState( _responseData.state ) );
        storage.password = null;
    }

}

///// Beer list helpers /////
async function mergeGroupData( _arrServerGroupIds, _joinGroup )
{
        console.log( `Groups: local=${storage.groups.length}, server=${_arrServerGroupIds.length} ${_joinGroup.length > 1 && "join group"}` );
        
        // Note that provided groups don't have an amount.
        const providedGoups = _arrServerGroupIds.map( guid => {
            return {
                group: guid,
                members: [ g_userhash ],
                name: nls.unknown || "UNKNOWN",
                beers: {}
            };
        } );

        // Did we get an invite?
        if ( _joinGroup.length > 1 )
            providedGoups.push( {
                group: _joinGroup[0],
                members: [ g_userhash ],
                token: _joinGroup[1],
                name: _joinGroup[2] || nls.unknown || "UNKNOWN",
                beers: {}
            } );

        // Verify Array of hashes against group
        providedGoups.forEach( providedGroup => {
            if ( !storage.groups.find( _group => _group.group === providedGroup.group ) )
            {
                // Assign to make sure the setter gets called
                const groups = storage.groups;
                groups.push( providedGroup );
                storage.groups = groups;
            }
        } );

        // Make a copy of the group so that sync can manupulate the original group
        const groupsClone = storage.groups.slice();
        for ( let n = 0; n < groupsClone.length; ++n)
        {
            await syncGroup( groupsClone[n] );
            await timeout( 10 );
        }
}

function addGroup( _groupName )
{
    const groups = storage.groups; 
    const group = {
        amount: 24,
        group: crypto.randomUUID(),
        members: [ g_userhash ],
        name: _groupName || nls.unknown || "UNKNOWN",
        beers: {}
    };
    groups.push( group );
    storage.groups = groups;
    syncGroup( group )
}

async function syncGroup( _group )
{
    // Do a server roundtrip and update the local group accordingly
    const group = Object.assign( {}, _group );
    delete group.name;

    // Extract keys (barcodes to hashes) to send to the server
    group.beers = await Promise.all( Object.keys( group.beers ).map( barcode => hash( barcode ) ) );

    // Provide group data to the server and await response
    const response = await serverRequest( "groupdata", group );

    const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === group.group );
    if ( groupIdx === -1 )
    {
        console.warn( `group not found: ${group.group}` )
        return;
    }

    if ( response.state == STATE.INSUFFICIENT_BEER || response.state == STATE.CHEERS )
    {
        // Success? remove any token.
        // TODO: verify assignment
        delete storage.groups[groupIdx].token;
        drawGroup( storage.groups[groupIdx], response.beers || [], response.users|0 );
    }
    else
    {
        // Error on this group request: remove the group
        // TODO: filter on specific errors to prevent local data "destruction"
        console.log( decodeState(response.state) );
        storage.groups = storage.groups.splice( groupIdx, 1 );

        // Make sure to remove the group from the page
        $( `#g${_group.group}` )?.remove();
    }
}

function drawGroup( _group, _flaggedBeers, _users )
{
    let groupDiv = $( `#g${_group.group}` );

    if ( !groupDiv || groupDiv.length === 0 )
        groupDiv = createGroup( _group.group, _group.name );

    // Set group data
    $(".name", groupDiv).value = _group.name;

    // Don't know the amount of beers?
    // You're probably not the originator, soft limit rights
    if ( !("amount" in _group) )
        $(".amount", groupDiv).setAttribute( "disabled", true );
    else
        $(".amount", groupDiv).value = _group.amount;

    // Handle beers
    const beerDiv = $(".beers", groupDiv);
    for ( const barcode in _group.beers )
        drawBeer( beerDiv, _group.group, barcode, _group.beers[barcode], _flaggedBeers );

    if ( _flaggedBeers )
    {
        let span = beerDiv.querySelector( "span" );
        if ( !span )
            span = beerDiv.insertAdjacentElement( "afterbegin", document.createElement( "span" ) )
        if ( _flaggedBeers.length )
            t( "buy_in_bulk", {textContent: span }, {amount:_users} );
        else
            t( "state.1", {textContent: span }, {amount:_users} );

    }
}

function createGroup( _groupId, _name )
{
    const groupDiv = document.createElement( "div" );
    groupDiv.id = "g"+_groupId;
    groupDiv.className = "group"

    const name = groupDiv.appendChild( document.createElement( "input" ) );
    name.className = "name";
    t("group_name", {placeholder:name});

    name.addEventListener( "change", ( _event ) =>
    {
        const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === _groupId );
        if ( groupIdx !== -1 )
        {
            // TODO: implement index setter accessor
            const groups = storage.groups; 
            groups[groupIdx].name = _event.target.value;
            storage.groups = groups;
            // No roundtrip needed
            drawGroup( storage.groups[groupIdx], null, null );
        }
    } );

    const amount = groupDiv.appendChild( document.createElement( "input" ) )
    amount.type = "number";
    amount.className = "amount";
    t("number_of_unique_beers", {placeholder:amount});

    amount.addEventListener( "change", ( _event ) =>
    {
        // Check if numeric
        if ( !_event.target.value|0 )
            return;

        const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === _groupId );
        if ( groupIdx !== -1 )
        {
            // TODO: implement index setter accessor
            const groups = storage.groups; 
            groups[groupIdx].amount = _event.target.value|0;
            storage.groups = groups;
            syncGroup( storage.groups[groupIdx] );
        }
    } );

    // AKA share link
    const inviteLink = groupDiv.appendChild( document.createElement( "button" ) )
    t("copy_invite_link", {textContent:inviteLink});

    inviteLink.addEventListener( "click", async ( _event ) =>
    {
        //https://beersurprise.glitchentertainment.nl/#3badba1b-dd8a-4d90-a0c4-45e991c84b8b/bOcIDykUl3wF2wIa8SH7Gycek2howvmtGX4X45l2WK683VxKeI6U1+JJuhNsRPmtF2w45u73JMcXQkWrFl40gA==/known        
        
        const uri = document.location.protocol + 
            "//" + document.location.host +
             document.location.pathname +
             "#" + _groupId +
             "/" + g_userhash + ( _name ?  "/" + encodeURI( _name ) : "" );

        try
        {
            await navigator.clipboard.writeText( uri );
            warn( t( _name ? "link_copied" : "anonymous_link_copied", {textContent: $("#warning")}), 5 );
        } catch {
            warn( t("copy_link_failed",{textContent: $("#warning")}) );
        }
    } );

    const refresh = groupDiv.appendChild( document.createElement( "button" ) )
    t("refresh_group", {textContent:refresh});

    refresh.addEventListener( "click", ( _event ) =>
    {
        const group = storage.groups.find( groupItem => groupItem.group === _groupId );
        if ( group )
            syncGroup( group );
    } );

    groupDiv.appendChild( document.createElement( "div" ) ).className = "beers";

    const beercode = groupDiv.appendChild( document.createElement( "input" ) );
    t("barcode", {placeholder:beercode});
    beercode.className = "beercode";
    const beerName = groupDiv.appendChild( document.createElement( "input" ) );
    t("beer_name", {placeholder:beerName});
    beerName.className = "beername";
    const addBeerButton = groupDiv.appendChild( document.createElement( "button" ) );
    t("add_beer", {textContent:addBeerButton});
    addBeerButton.addEventListener( "click", async ( _event ) =>
    {
        addBeer( _groupId, beercode.value, beerName.value );
    } );

    // Scan button, if browser supports it
    if ( "mediaDevices" in navigator )
    {
        const scanButton = groupDiv.appendChild( document.createElement( "button" ) );
        t("scan_barcode", {textContent:scanButton});
        scanButton.addEventListener( "click", async ( _event ) =>
        {
            const barcode = await startScan();
            if ( barcode )
                addBeer( _groupId, barcode, beerName.value || t( "scanned_beer" ) );
        } );
    }

    $( "#groups" ).appendChild( groupDiv );
    return groupDiv;
}

function addBeer( _groupId, _barcode, _beername )
{
    if ( !_barcode )
        return;

    const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === _groupId );
    if ( groupIdx === -1 )
        return;

    // TODO: implement index setter accessor
    const groups = storage.groups; 

    if ( !(_barcode in groups[groupIdx].beers) )
    {
        groups[groupIdx].beers[_barcode] = _beername;
        storage.groups = groups;
        syncGroup( storage.groups[groupIdx] );
    }
    else
    {
        // Barcode already in the list
    }
}

async function drawBeer( _parent, _groupId, _barcode, _name, _flaggedBeers )
{
    // TODO: value?
    let beerDiv = $( `input[name='${_barcode}']`, _parent );

    if ( !beerDiv || beerDiv.length === 0 )
        beerDiv = createBeer( _parent, _groupId, _barcode, _name );
    else
        beerDiv = beerDiv.parentElement;

    // Set flagged state (only if we got an array)
    if ( _flaggedBeers )
    {
        const barHash = await hash( _barcode );
        $( "input", beerDiv ).forEach( i => i.style.backgroundColor = _flaggedBeers.includes(barHash) ? "lime" : "" );
    }
}

function createBeer( _parent, _groupId, _barcode, _name )
{
    const beerItem = _parent.appendChild( document.createElement( "div" ) );
    const beercode = beerItem.appendChild( document.createElement( "input" ) );
    beercode.value = _barcode;
    beercode.name = _barcode;
    beercode.disabled = true;
    // Note: if we want to change the barcode, we have to remove the beer
    
    const beerName = beerItem.appendChild( document.createElement( "input" ) );
    beerName.value = _name;
    beerName.addEventListener( "change", ( _event ) =>
    {
        const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === _groupId );
        if ( groupIdx !== -1 )
        {
            // TODO: implement index setter accessor
            const groups = storage.groups; 
            groups[groupIdx].beers[_barcode] = _event.target.value;
            storage.groups = groups;
            // No roundtrip needed
            drawBeer( _parent, _groupId, _barcode, _name, null );
        }
    } );

    const deleteBeer = beerItem.appendChild( document.createElement( "button" ) );
    //t("delete_beer",{value:deleteBeer});
    deleteBeer.textContent = "X";

    deleteBeer.addEventListener( "click", ( _event ) =>
    {
        const groupIdx = storage.groups.findIndex( groupItem => groupItem.group === _groupId );
        if ( groupIdx !== -1 )
        {
            beerItem.remove();

            // TODO: implement index setter accessor
            const groups = storage.groups;
            delete groups[groupIdx].beers[_barcode];
            storage.groups = groups;
            syncGroup( storage.groups[groupIdx] );

        }
    } );

    document.querySelector( ".beercode" ).value = "";
    document.querySelector( ".beername" ).value = "";
    return beerItem;
}

const timeout = async( _ms ) => {
    return new Promise( resolve => {
        setTimeout( resolve, _ms );
    })
}

let timer = null;
function warn( _message, _timeout )
{
    // TODO: handle newline: split in divs
    const warning = $("#warning");
    warning.textContent = _message;
    warning.style.display = "block";
    if ( timer )
        clearTimeout( timer );
    timer = setTimeout( ()=>{warning.style.display = "none"}, 1000 * (_timeout || 3) );
}

function decodeState( _state )
{
    return ( t(`state.${_state}`) );
}

///// Login and data helpers /////
async function handleCredentials( _command )
{
    // Sanity check
    if ( !g_userhash || !storage.passhash )
    {
        console.error( "no credentials provided: cannot request anything" );
        return;
    }

    let response = null;
    switch ( _command )
    {
        case "login":
            response = await serverRequest( "groupdata", null );
            loggedin( response );
            break;

        case "register":
            // Force `null` credentials
            response = await serverRequest( "password", storage.passhash, null );
            if ( response.state === STATE.CHEERS )
            {
                warn( t("account_created",{textContent: $("#warning")}) );

                // Empty group data will trigger sequential group detail calls
                response = await serverRequest( "groupdata", null );
                loggedin( response );
            }
            break;

        default:
            // Change password, use the previous hash
            response = await serverRequest( "password", storage.passhash, g_passhash );
            if ( response.state === STATE.CHEERS )
            {
                warn( t("password_updated",{textContent: $("#warning")}) );
                g_passhash = storage.passhash;
            }
            break;
    }

    if ( !response.state === STATE.CHEERS )
        warn( decodeState( response.state ) );
}

async function submit( event )
{
    const username = $( "#username" );
    const password = $( "#password" );
    const command = event.target.command;

    event.preventDefault();

    // Early out any register that is cancelled
    if ( event.target.command === "register"
        && !confirm( t( "register_username", null, {username:username.value}) ) )
        return false;

    handleCredentials( command );

    // Clear password (and replace with the salted hash)
    password.value = "";

    // Don't post this form; wait for the hashes to complete and post those
    return false;
}

let g_userhash = null;
let g_passhash = null;

async function updateUser( _event )
{
    const newUsername = _event.target.value;
    if ( storage.username !== newUsername )
    {
        storage.password = null;
        storage.username = newUsername;
        g_userhash = await hash( newUsername );
    }
}

async function serverRequest( _command, _data, _customCredentials = false)
{
    const data =
    {
        command: _command,
        userhash: g_userhash,
        passhash: _customCredentials === false ? storage.passhash : _customCredentials,
        data: _data
    };

    const options =
    {
        method: "POST",
        body: JSON.stringify( data ),
        headers:
        {
            "Content-Type": "application/json"
        }
    }

    try
    {
        // register
        return (await fetch( ".", options )).json( );
    }
    catch( e )
    {
        console.warn( "could not parse as json", response );
        return { state: STATE.MALFOAMED };
    }
}

///// i18n / internationalization methods /////
function t( name, target/*by reference object*/, values )
{
    const nlsName = nls[name] && nls[name].replace( /\{(.*?)\}/g, (_,t) => { return values[t] } );

    if ( target )
    {
        if ( nlsName )
        {
            const key = Object.keys( target )[0];
            target[key][key] = nlsName;
        }
        else
        {
            if ( Object.keys(nls).length )
                console.log( `No translation for ${name}` );
            target.name = name;
            addNlsQueue( target, values );
            
        }
    }

    return nlsName||name;
}

function addNlsQueue( target, values )
{
    nlsQueue.push( [target, values] );

    // TODO: set a timeout in case the loading mechanism crossed the queue
}

async function loadNls()
{
    // Global NLS struct
    window.nlsQueue = [];
    window.nls = {};

    // Store globally for the dynamic elements
    const nls = window.nls = await (await fetch("nls/nl-nl.json")).json();

    while ( item = nlsQueue.shift() )
    {
        const [target, values] = item;
        const nlsName = nls[target.name] && nls[target.name].replace( /\{(.*?)\}/g, (_,t) => { return values[t] } );

        const key = Object.keys( target )[0];
        target[key][key] = nlsName||target.name;
        if ( !nlsName)
            console.log( `No translation for ${target.name}` );
    }

    $( '[data-placeholder],[data-value],[data-text-content]' ).forEach( node => {
        for ( let attribute in node.dataset )
        {
            const name = node.dataset[attribute];
            if ( name in nls )
                node[attribute] = nls[name];
        }
    } );
}

///// Main function /////
async function initialize( _event )
{
    const account = $( "#account" );
    const username = $( "#username" );
    const password = $( "#password" );
    account.addEventListener( "submit", submit );
    username.addEventListener( "change", updateUser );
    username.addEventListener( "keydown", updateUser );
    username.addEventListener( "keyup", updateUser );
    username.value = storage.username;
    password.addEventListener( "keyup", (e)=>{if (e.target.value) storage.password = e.target.value} );
    password.addEventListener( "change", (e)=>{if (e.target.value) storage.password = e.target.value} );
    // password.addEventListener( "paste", (e)=>{console.log(e)} );
    // password.addEventListener( "keypress", (e)=>{console.log(e.target.value)} );

    loadNls();

    // Store user hash (volatile)
    g_userhash = await hash( username.value );

    // If we have a stored passhash, try and login (get user groups)
    if ( storage.passhash )
    {
        console.log( "autologin" );
        // Empty group data will trigger sequential group detail calls
        const result = await serverRequest( "groupdata", null );

        // handles groups as well
        loggedin( result );
    }
    else if ( location.hash )
    {
        // Highlight login/register inputs for people not yet logged in
        $("#account").classList.toggle( "attention", true );
        warn( t("join_as_new_user",{textContent: $("#warning")}), 300 );
    }

}

window.addEventListener( "load", initialize );

