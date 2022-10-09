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

async function startScan()
{
    // Detect supported types and filter everything that looks like a product
    const formats = intersectArray(  await BarcodeDetector.getSupportedFormats(), ["ean_8", "ean_13", "ean_13+2", "ean_13+5", "isbn_10", "isbn_13", "isbn_13+2", "isbn_13+5", "upc_a", "upc_e"], true );
    const barcodeDetector = new BarcodeDetector({formats});

    // Start camera
    return navigator.mediaDevices.getUserMedia( {
      video: {facingMode: "environment", torch: true, focusMode: "continuous"}
    } ).then( ( mediaStream ) => {
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
            //video.onload = resolve;
            video.onplay = resolve;
            video.onerror = reject;
            video.autoplay = true;
            // onloadstart
        });


        overlay.appendChild( document.createElement("div") ).className = "scanner";

        document.body.appendChild( overlay );

        // https://stackoverflow.com/questions/37848494/is-it-possible-to-control-the-camera-light-on-a-phone-via-a-website
        const track = mediaStream.getVideoTracks()[0];
        // mediaStream.getTracks().forEach(function(track)
        track.applyConstraints({torch: true, focusMode: "continuous"});
        
        // https://developer.chrome.com/blog/chrome-66-deprecations/
        // imageCapture = new ImageCapture(track).setOptions
        track.applyConstraints({ advanced: [{torch: true, focusMode: "continuous"}]}).catch(e => console.log(e));

        function detect( video )
        {
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
                        resolve( barcodes );
                })();
            })
        }

        const scanPromise = videoPromise.then( ( event ) => { return detect( event.target )} ).then( ( barcodes ) => {
            return barcodes[0].rawValue;
        });

        return Promise.race( [scanPromise, closePromise] ).then( ( barcode ) => {
            // Cleanup
            overlay.remove();
            mediaStream.getTracks().forEach(function(track) {
                track.stop();
              });

            return barcode;
        });;
    } ).catch( (error) => {
        if ( error.name === "NotAllowedError" )
            warn( t( "please_enable_camera_permissions", {textContent: $("#warning")}) );
        else
            console.error( error );
    } );
}

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

    return crypto.subtle.digest( "SHA-512", new TextEncoder().encode( data ) ).then( encode64 );
}

// Base64 encode of arraybuffer
function encode64( _buffer )
{
    return btoa( new Uint8Array( _buffer ).reduce( (s, b) => s + String.fromCharCode( b ), "" ) );
}

function loggedin( state )
{
    t( state ? "change_pw" : "register",  {value:$("#register")});
    $("#login").disabled = !!state;
    $("#newgroup").style.display = state ? "block" : "none";
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

function handleCredentials( _passhash, _command )
{
    const storedPassHash = localStorage.getItem( "passhash" );

    // Sanity check
    if ( !g_userhash || ( !_passhash && !storedPassHash ) )
    {
        console.error( "no credentials provided: cannot request anything" );
        return;
    }

    switch ( _command )
    {
        case "login":
            localStorage.setItem( "passhash", _passhash );
            serverRequest( "groupdata", null ).then( handleResponse );
            break;

        case "register":
            localStorage.removeItem( "passhash" );
            serverRequest( "password", _passhash ).then( handleResponse );
            break;

        default:
            // Change password
            serverRequest( "password", _passhash ).then( handleResponse );
            break;

    }
}

function submit( event )
{
    const username = $( "#username" );
    const password = $( "#password" );
    const command = event.target.command;

    event.preventDefault();

    // Early out any register that is cancelled
    if ( event.target.command === "register"
        && !confirm( t( "register_username", null, {username:username.value}) ) )
        return false;

    // hash (+salt) password
    hash( password.value, username.value ).then( ( passhash ) =>
    {
        handleCredentials( passhash, command );
    } );

    // Clear password (and replace with the salted hash)
    password.value = "";

    // Don't post this form; wait for the hashes to complete and post those
    return false;
}

let g_userhash = null;

function updateUser( _event )
{
    const newUsername = _event.target.value;
    if ( localStorage.getItem( "username" ) !== newUsername )
    {
        localStorage.removeItem( "passhash" );
        localStorage.setItem( "username", newUsername );
        hash( newUsername ).then( ( userhash ) =>
        {
            g_userhash = userhash;
        } );
    }
}

// i18n / internationalization
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

function loadNls()
{
    // Global NLS struct
    window.nlsQueue = [];
    window.nls = {};

    fetch("nls/nl-nl.json")
    .then((response) => response.json())
    .then((nls) => {
        // Store globally for the dynamic elements
        window.nls = nls;

        let target;
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
    });

}

function initialize( _event )
{
    loadNls();

    const username = $( "#username" );
    const account = $( "#account" );
    account.addEventListener( "submit", submit );
    username.addEventListener( "change", updateUser );
    username.addEventListener( "keydown", updateUser );
    username.addEventListener( "keyup", updateUser );

    username.value = localStorage.getItem( "username" );

    // Store user hash (volatile)
    hash( username.value ).then( ( userhash ) =>
    {
        g_userhash = userhash;

        // If we have a stored passhash, try and login (get user groups)
        if ( localStorage.getItem( "passhash" ) )
        {
            // if ( location.hash )
            // {
            //     joinGroup( ...location.hash.slice( 1 ).split( "/" ) );
            // }
            // else
            {
                console.log( "autologin" );
                // Empty group data will trigger sequential group detail calls
                serverRequest( "groupdata", null ).then( handleResponse );
            }
        } else if ( location.hash )
        {
            // Highlight login/register inputs for people not yet logged in
            $("#account").classList.toggle( "attention", true );
            warn( t("join_as_new_user",{textContent: $("#warning")}), 300 );
        }

    } );

    const groups = JSON.parse( localStorage.getItem( "groups" ) || "[]" );
    groups.forEach( setGroup );
}

function random( _a, _b )
{
    return Math.round( Math.random() * 2 ) - 1;
}

function flagBeers( _guid, _beers, _users )
{
    const beerGroup = $( `#g${_guid} .beers` );
    const beerInputs = beerGroup.querySelectorAll( "input:nth-of-type(2n-1)" );
    beerInputs.forEach( async (beerInput) => {
        const beerHash = await hash( beerInput.value );
        if ( _beers.includes( beerHash ) )
            beerInput.style.backgroundColor = beerInput.nextSibling.style.backgroundColor = "lime";
    } );

    let span = beerGroup.querySelector( "span" );
    if ( !span )
        span = beerGroup.insertAdjacentElement( "afterbegin", document.createElement( "span" ) )
    t( "buy_in_bulk", {textContent: span }, {amount:_users} );
    
    span.dataset.textContent = nls.bulk_buy;
}

function handleResponse( [ _responseData, _requestData ] )
{
    switch ( _requestData.command )
    {
        case "groupdata":
            // Determine "subcommand"

            if ( !_requestData.data )
            {
                // login/get groups
                loggedin( _responseData.state === STATE.CHEERS )
                if ( _responseData.state === STATE.CHEERS )
                {
                    // Success: store passhash and username
                    localStorage.setItem( "username", $( "#username" ).value );
                    localStorage.setItem( "passhash", _requestData.passhash );

                    // If we have a group, update immediately
                    if ( location.hash )
                        joinGroup( ...location.hash.slice( 1 ).split( "/" ) );
                    
                    // Verify Array of hashes against localstorage["groups"].group
                    console.log( "Number of groups on server:", _responseData.group.length );
                    
                    const groups = JSON.parse( localStorage.getItem( "groups" ) || "[]" );                    
                    _responseData.group.forEach( _guid => {
                        if ( !groups.find( _group => _group.group === _guid ) )
                            addGroup( nls.unknown || "UNKNOWN", _guid, true );
                    } );
                    
                    // TODO: verify throttle
                    groups.forEach( async (_group) => {
                        // TODO: throttle requests or send as array
                        await updateGroup( _group );
                    } );
                }
                else
                {
                    warn( decodeState( _responseData.state ) );
                    localStorage.removeItem( "passhash" );
                }
            }
            else
            {
                // Set group
                if ( _responseData.state === STATE.CHEERS )
                {
                    // All beers fullfilled, flag them for buying
                    flagBeers( _requestData.data.group, _responseData.beers, _responseData.users );
                }
                else
                {
                    if ( _responseData.state === STATE.INSUFFICIENT_BEER )
                    {
                        // Set warning inside the group
                        const beerGroup = $( `#g${_requestData.data.group} .beers` );

                        let span = beerGroup.querySelector( "span" );
                        if ( !span )
                            span = beerGroup.insertAdjacentElement( "afterbegin", document.createElement( "span" ) )
                        span.textContent = decodeState( _responseData.state );
                    }
                    else
                    {
                        warn( decodeState( _responseData.state ) );
                    }
                }

            }
            break;

        case "password":
            if ( _responseData.state === STATE.CHEERS )
            {
                localStorage.setItem( "passhash", _requestData.data );
                if ( _requestData.passhash && _requestData.data )
                    warn( t("password_updated",{textContent: $("#warning")}) );
                else if ( !_requestData.passhash && _requestData.data )
                {
                    // If we have a group, update immediately
                    if ( location.hash )
                        joinGroup( ...location.hash.slice( 1 ).split( "/" ) );

                        warn( t("account_created",{textContent: $("#warning")}) );
                        // TODO: send login request or just load groups
                        // Empty group data will trigger sequential group detail calls
                        serverRequest( "groupdata", null ).then( handleResponse );
                }
                else
                    console.warn( t("unknown_success",{textContent: $("#warning")}) );
            }
            else
            {
                warn( decodeState( _responseData.state ) );
            }
            break;

        default:
            console.warn( "could not decode command: ", _requestData.command );
            break;
    }
    
    return _responseData;
}

async function serverRequest( _command, _data )
{
    // NOTE: before setting an array, it's best to get the data to prevent data loss
    // post body data
    const data =
    {
        command: _command,
        userhash: g_userhash,
        passhash: localStorage.getItem( "passhash" ),
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

    // Clean up server response and parse as JSON
    return fetch( ".", options )
        /*.then( res => res.json( ) )*/
        .then( res => res.text( ) )
        .then( res =>
        {
            try
            {
                // register
                res = JSON.parse( res );
            }
            catch( e )
            {
                console.warn( "could not parse as json", res );
                res = { state: STATE.MALFOAMED };
            }

            return [ res, data ];
        } );
}

function getOrCreateGroup( _groupName, _guid )
{
    const groups = JSON.parse( localStorage.getItem( "groups" ) || "[]" );
    const storedGroup = groups.find( (g) => g.group === _guid );
    
    if ( storedGroup )
    {
        console.log( `Existing group ${storedGroup.name} (${_guid})` );
        delete storedGroup.name;
        return storedGroup;
    }
    
    console.log( `New group ${_groupName} (${_guid})` );

    const group = {
        group: _guid,
        members: [ g_userhash ],
        name: _groupName
    };

    groups.push( group );
    localStorage.setItem( "groups", JSON.stringify( groups ) );

    delete group.name;
    return group;   
}

function joinGroup(guid, token, name)
{
    if ( !guid )
        return;
    // Create group info (without name)
    const group = {
        group: guid,
        members: [ g_userhash ],
        token: token
    };

    serverRequest( "groupdata", group ).then( ( data ) => {
        const unknown = nls.unknown || "UNKNOWN";
        // Add the group locally, no roundtrip
        const responseState = data[0].state;
        if ( responseState === STATE.CHEERS || responseState === STATE.INSUFFICIENT_BEER )
            addGroup( name ? decodeURI( name ) : unknown, guid, true );
        handleResponse( data );
        // Remove hash
        window.location.replace(window.location.protocol + "//" + window.location.host);
    } )
}

function addGroup( _groupName, _guid, _skipServerCall )
{
    const guid = _guid ? _guid : crypto.randomUUID();
    
    // Create group info (without name)
    const group = getOrCreateGroup( _groupName, guid );
    
    if ( !_skipServerCall )
        group.amount = 24;
    
    // Add the name only locally
    const myGroup = Object.assign( { name: _groupName }, group );

    // Submit data to server
    if ( !_skipServerCall )
        updateGroup( group );

    // TODO: we may want to check if the post went ok
    setGroup( myGroup );
}

async function updateGroup( _group )
{
    const groups = JSON.parse( localStorage.getItem( "groups" ) || "[]" );
    const groupIdx = groups.findIndex( (g) => g.group === _group.group );

    if ( groupIdx >= 0 )
        groups[groupIdx] = _group;
    else
        console.warn( "group not found" );    

    localStorage.setItem( "groups", JSON.stringify( groups ) );

    // Submit data to server (remove name from server request)
    const myGroup = Object.assign( {}, _group );
    delete myGroup.name;

    /*
    const barcodes = Promise.all( myGroup.beers.map( beer => hash( beer.barcode ) ) );
    barcodes.then( codes => {
        myGroup.beers = codes;
        serverRequest( "groupdata", myGroup ).then( handleResponse );
    } );
    */

    if ( myGroup.beers )
        myGroup.beers = await Promise.all( myGroup.beers.map( beer => hash( beer.barcode ) ) );
    else
        myGroup.beers = [];
    return serverRequest( "groupdata", myGroup ).then( handleResponse );
}

function setGroup( _group )
{
    let groupDiv = $( "#g"+_group.group );

    if ( !groupDiv || groupDiv.length === 0 )
    {
        groupDiv = document.createElement( "div" );
        groupDiv.id = "g"+_group.group;
        groupDiv.className = "group"

        const name = groupDiv.appendChild( document.createElement( "input" ) );
        name.className = "name";
        t("group_name", {placeholder:name});

        name.addEventListener( "change", ( _event ) =>
        {
            _group.name = _event.target.value;
            updateGroup( _group );
        } );

        const amount = groupDiv.appendChild( document.createElement( "input" ) )
        amount.type = "number";
        amount.className = "amount";
        t("number_of_unique_beers", {placeholder:amount});

        // Don't know the amount of beers?
        // You're probably not the originator, soft limit rights
        if ( !_group.amount )
            amount.setAttribute( "disabled", true );
        else
        {
            amount.addEventListener( "change", ( _event ) =>
            {
                if ( _event.target.value|0 )
                {
                    _group.amount = _event.target.value;
                    updateGroup( _group );
                }
            } );
        }

        // AKA share link
        const inviteLink = groupDiv.appendChild( document.createElement( "button" ) )
        t("copy_invite_link", {textContent:inviteLink});

        inviteLink.addEventListener( "click", ( _event ) =>
        {
            //https://beersurprise.glitchentertainment.nl/#3badba1b-dd8a-4d90-a0c4-45e991c84b8b/bOcIDykUl3wF2wIa8SH7Gycek2howvmtGX4X45l2WK683VxKeI6U1+JJuhNsRPmtF2w45u73JMcXQkWrFl40gA==/known        
            
            const uri = document.location.protocol + 
                "//" + document.location.host +
                 document.location.pathname +
                 "#" + _group.group +
                 "/" + g_userhash +
                 "/" + encodeURI( _group.name );

            navigator.clipboard.writeText( uri ).then( () => 
            {
                warn( t("link_copied",{textContent: $("#warning")}), 5 );
            }, () => 
            {
                warn( t("copy_link_failed",{textContent: $("#warning")}) );
            });
        } );

        const refresh = groupDiv.appendChild( document.createElement( "button" ) )
        t("refresh_group", {textContent:refresh});

        refresh.addEventListener( "click", ( _event ) =>
        {
            updateGroup( _group );
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
            addBeer( groupDiv, _group, beercode.value, beerName.value );
        } );

        // Scan button, if browser supports it
        if ( "mediaDevices" in navigator )
        {
            const scanButton = groupDiv.appendChild( document.createElement( "button" ) );
            t("scan_barcode", {textContent:scanButton});
            scanButton.addEventListener( "click", async ( _event ) =>
            {
                //add_Beer()
                const barcode = await startScan();
                if ( barcode )
                    addBeer( groupDiv, _group, barcode, t( "scanned_beer" ) );
            } );
        }

        $( "#groups" ).appendChild( groupDiv );
    }

    const name = groupDiv.querySelector( ".name" );
    const amount = groupDiv.querySelector( ".amount" );

    name.value = _group.name;

    // Skip non-amounts
    if ( _group.amount )
        amount.value = _group.amount;

    if ( _group.beers )
        _group.beers.sort( random ).forEach( ( beer ) => setBeer( groupDiv, beer, _group ) );
}

async function addBeer( _node, _group, _barcode, _name )
{
    if ( !_barcode )
        return;

    const beer = { barcode: _barcode, name: _name };

    // TODO: check if the beer already is added?
    if ( !_group.beers )
        _group.beers = [];
    _group.beers.push( beer );

    // Submit data to server (remove name from server request)
    await updateGroup( _group );
    setBeer( _node, beer, _group );
}

function setBeer( _node, _beer, _group )
{
    const beers = _node.querySelector( ".beers" );
    
    // TODO: filter duplicates
    //beers.querySelectorAll( `input[name='${_beer.barcode}']` )
    //    beers.querySelectorAll( `input:nth-of-type(2n-1)` )

    const existingInput = beers.querySelector( `input[name="${_beer.barcode}"]` )

    if ( existingInput )
        return;

    const beerItem = beers.appendChild( document.createElement( "div" ) );




    const beercode = beerItem.appendChild( document.createElement( "input" ) );
    beercode.value = _beer.barcode;
    beercode.name = _beer.barcode;
    beercode.disabled = true;
    // Note: if we want to change the barcode, we have to remove it
    
    const beerName = beerItem.appendChild( document.createElement( "input" ) );
    beerName.value = _beer.name;
    beerName.addEventListener( "change", ( _event ) =>
    {
        // TODO: only update local storage: no roundtrip
        //_beer.name = _event.target.value;
        //updateBeer( _group );
        //updateGroup( _group )
    } );

    const deleteBeer = beerItem.appendChild( document.createElement( "button" ) );
    //t("delete_beer",{value:deleteBeer});
    deleteBeer.textContent = "X";

    deleteBeer.addEventListener( "click", ( _event ) =>
    {
        beerIdx = _group.beers.findIndex( beer => beer.barcode === _beer.barcode );
        if ( beerIdx >= 0 )
        {
            _group.beers.splice( beerIdx, 1 );
            updateGroup( _group );
        }

        // Delete beer from group and update group
        const beerGroup = $( `#g${_group.group} .beers` );
        const beerInputs = beerGroup.querySelectorAll( "input:nth-of-type(2n-1)" );
        beerInputs.forEach( (beerInput) => {
            if ( _beer.barcode === beerInput.value )
            {
                beerInput.parentElement.remove();
            }
        } );
    } );

    _node.querySelector( ".beercode" ).value = "";
    _node.querySelector( ".beername" ).value = "";
}


window.addEventListener( "load", initialize );

