<?php
// For debugging purpose:
//error_reporting(E_ALL);
//ini_set('display_errors', 1);

// Redirect to https, if needed
if ( !isset($_SERVER[ "HTTPS" ] ) && $_SERVER["SERVER_NAME"] !== "localhost" )
{
    //header( "HTTP/1.1 301 Moved Permanently" );
    header( "Location: https://" . $_SERVER[ "HTTP_HOST" ] . "/" );
    exit;
}

$STATE = Array(
    "MALFOAMED" => -1,
    "EMPTY" => 0,
    "INSUFFICIENT_BEER" => 1,
    "DRUNK" => 13,
    "BARSTOOL_TAKEN" => 23,
    "CHEERS" => 42,
    "THE_MORE_YOU_DRINK_THE_WC" => 666,
);

if ( !extension_loaded( "sqlite3" ) )
{
    die( "sqlite3 is not installed (run sudo apt install php-sqlite3)" );
}

$dbFile = "../beersurprise.db";
try
{
    $db = new SQLite3( $dbFile );
    $db->exec("PRAGMA foreign_keys = ON");

    // User table
    $db->exec("CREATE TABLE IF NOT EXISTS users(
        user TEXT PRIMARY KEY,
        pass TEXT,
        activeweek INTEGER,
        activeyear INTEGER
    )");

    // Group table
    $db->exec("CREATE TABLE IF NOT EXISTS groups(
        guid TEXT PRIMARY KEY,
        amount INTEGER
    )");

    // User/Group junction table
    $db->exec("CREATE TABLE IF NOT EXISTS groupusers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guid TEXT,
        user TEXT,
        UNIQUE(guid, user)
    )");

    // User/Group beer table
    $db->exec("CREATE TABLE IF NOT EXISTS usergroupbeers(
        groupuserid INTEGER REFERENCES groupusers(id),
        beer TEXT,
        PRIMARY KEY( groupuserid, beer )
    )");

}
catch ( exception $e )
{
    die( "Error opening or creating database: " . $dbFile );
}

function verifyUser( $db, $userhash, $passhash = null )
{
    // User verification
    if ( $passhash === null )
        $stm = $db->prepare('SELECT rowid FROM users WHERE user = ?');
    else
        $stm = $db->prepare('SELECT rowid FROM users WHERE user = ? AND pass = ?');
    $stm->bindValue(1, $userhash, SQLITE3_TEXT);
    $stm->bindValue(2, $passhash, SQLITE3_TEXT);
    $res = $stm->execute();

    // TODO: throttle IP for 2 seconds on all requests
    if ( !$res->fetchArray() )
    {
        sleep( 2 );
        return false;
    }
    
    return true;
}

if ( $_SERVER["REQUEST_METHOD"] == "POST")
{
    // Helpers
    include_once( "groupdata.php" );
    include_once( "password.php" );

    // NOTE: we're not using form data ($_POST) but message body
    $post = json_decode( @file_get_contents( "php://input" ), true );
    if( json_last_error() !== JSON_ERROR_NONE )
        die( '{"state":'.$STATE["MALFOAMED"].'}' );


    // Set of commands:
    switch ( $post["command"] )
    {
        case "groupdata":   
            // get/set the group(s) and corresponding data
            groupdata( $db, $post);
            break;
        case "password":
            // create account or change password
            password( $db, $post);
            break;
    }

    die( '{"state":'.$STATE["MALFOAMED"].'}' );
}
?>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Beer surprise!</title>
<link rel="stylesheet" href="beersurprise.css"/>
<script>
    // Promisified require lib
    const require = function(source)
    {
        return new Promise( ( resolve, reject ) => {
            var script = document.createElement("script");
                script.async = true;
                script.type = "text/javascript";
                script.src = source;
                script.onload = resolve;
                script.onerror = reject;
                (document.getElementsByTagName("head")[0] || document.getElementsByTagName("body")[0]).appendChild(script);
        });
    }

    if (!("BarcodeDetector" in window))
        loadBarcodeDetectorPolyfill();

    async function loadBarcodeDetectorPolyfill()
    {
        // BarcodeDetector polyfill
        await require("/resources/zbar-wasm.js");
        await require("/resources//barcode-detector-polyfill.js");
        window.BarcodeDetector = barcodeDetectorPolyfill.BarcodeDetectorPolyfill;
    }
</script>

<script type="text/javascript">
<?php
    echo "const STATE = {";
    foreach ( $STATE as $key => $value )
        echo $key . ":" . $value.",";
    echo "}";
?>
</script>
<script type="text/javascript" src="beersurprise.js"></script>
</head>
<body>
<div id="warning" style="display:none">Warning goes here...</div>
<section>
<form id="account" type="POST" action=".">
<input id="username" name="username" type="text" data-placeholder="username" placeholder="Username">
<input id="password" name="password" type="password" data-placeholder="password" placeholder="Password (hashed)" autocomplete="off">
<input id="login" type="submit" data-value="login" value="login" onclick="this.form.command=this.dataset.value;">
<input id="register" type="submit" data-value="register" value="register" onclick="this.form.command=this.dataset.value;">
</form>
</br>
</section>

<section id="newgroup">
<input id="group" name="group" type="text" data-placeholder="new_group_name" placeholder="New group name">
<button onclick="addGroup($('#group').value)" data-text-content="add_group" id="addgroup">add group</button>
</section>

<section id="groups">
</section>


<section id="information" class="collapse">
<h3>How it works</h3>
<div>
This site lets you create a group where you and other group members can enter a list of suggested beers.<br/>
Say your group consists of 6 people and want to create a beer advent calendar of 24 beers, each member will have to add more than 4 unique beers (there is actually margin added).<br/>
After everyone has completed their personal list, the system will provide a set of 4 unique beers for each member one will have to buy (in 6-fold: one set for each member).<br/>
Wrap them up (mark and group them), put all the member's beers in 6 boxes (preferrably in the same marked order) and enjoy.
<br/>
For first time users:
<ul>
    <li>Register a username and password and verify with "ok"; it will be stored in the browser for auto login next time</li>
    <li>Either login or refresh the page</li>
</ul>
To create a new group:
<ul>
    <li>Fill in a group name, click "add group" or open an invite link to join an existing group</li>
    <li>If you're the group creator: fill in the number of unique beers, i.e. 24 for a Christmas advent, or 8 for Hanukkah<br/>
    Best options are easy dividable numbers like 12</li>
</ul>
To fill a group with beers:
<ul>
    <li>Fill in a barcode (important) and an easy name/description;<br/>
        the barcode (hashed) will be used as comparison.<br/>
        If a beer has no barcode, make consensus on how to name the beer (i.e. all lower case, no interpunction, or something like "brewer - beername");<br/>
        make sure to use consistent spelling or the hashes won't match and you will end up with the same beer twice
    </li>
    <li>If you've entered enough beers (actual margin is "unique beers / number of persons + 25%"), the system will provide a set of beers to buy.<br/>
    For example: 3 people having 24 beers need 8(+25%) = 10 beers in their list.<br/>
    The system then will choose a set for you to buy</li>
    <li>If the system didn't provide a list yet, you have to mutually agree to add another beer to your list.</li>
    <li>Buy the beers (times the number of persons), wrap them and join them with the others to make unique sets (you may want to number your wraps)</li>
    <li>Cheers!</li>
</ul>
Note: you could mutually agree to choose something different, like wine, cheese, chocolate or gadgets.
    </div>
</section>

<section id="privacy" class="collapse">
<h3>Privacy: what we store</h3>
<div>
In short: we don't want your data, but:
We need <i>some</i> information of you and your group members to make a non-conflicting list of beers.
<h4>On our server (database):</h4>
<ul>
    <li>a hash of your username</li>
    <li>a salted hash of your password</li>
    <li>the weeknumber and year of your last login (for cleaning up stale accounts)</li>
    <li>a UUID of a group with references to the username hashes</li>
    <li>(indirectly) the number of group members</li>
    <li>an integer number of the number of different beers to select</li>
    <li>a hash of the barcodes of each of the beers you added</li>
</ul>
<h4>In your browser (localStorage):</h4>
<ul>
    <li>your username</li>
    <li>a salted hash of your password</li>
    <li>group UUIDs and their name</li>
    <li>hashes of the group members (the ones you've added)</li>    
    <li>your beers per group UUID:
    <ul>
        <li>the barcode</li>
        <li>the name (optional)</li>
        <li>a description (optional)</li>
    </ul>
    </li>
</ul>
<h4>We generate (server to client):</h4>
<ul>
    <li>list of beerhashes for a group UUID where you can derive your selected beers from, masked per user</li>
    <li>When the list is incomplete, a fault message: INSUFFICIENT_BEER, BEER_OVERLAP, ...</li>
    <li>the integer number of group (UUID) members</li>
</ul>
This website needs JavaScript to make sure no identifyable data is sent across the line; it's used to generate the hashes using the browser's SubtleCrypto digest method.
</section>

<section id="extra" class="collapse">
<h3>Extra notes</h3>
<div>
Please note the following:
<ul>
    <li>The EAN-8 code to hash conversion becomes a fairly small set (only 10 million combinations and a checksum digit). They are relatively easy to reverse / rainbow table if you know the hash.</li>
    <li>The password hash is salted with the username, which makes it harder to crack using rainbow tables.</li>
    <li>If your locally stored username and passwordhash leak; other people will have full control of the groups you are a member of.</li>
    <li>The camera is used to scan a barcode for ease of use and is optional (your browser will ask for permission).</li>
    <li>The barcode scanning is done by the operating system (using shape recognition), if available.<br/>
        It will fall back to a webassembly polyfill by <a target="_blank" href="https://github.com/undecaf/barcode-detector-polyfill">undecaf available on github</a></li>
</ul>
</div>
</section>

<section id="glossary" class="collapse">
<h3>Glossary</h3>
<div>
<ul>
    <li><b>hash</b>: a oneway "fingerprint" of a piece of text (or data) that cannot be reversed back to the original data</li>
    <li><b>UUID</b>: a unique (random) identifier that doesn't reference to any name (or data; only locally)</li>
    <li><b>EAN</b>: European Article Number: the defacto standard of identifying products.</li>
    <li><b>webassembly</b>: A binary executable (running in a sandbox) that is built for optimal performance.</li>
    <li><b>polyfill</b>: A piece of code that mimics the functionality of a browser standard when it is not available on your platform.</li>
    <li><b>sandbox</b>: An isolated memory space within the browser.</li>
</ul>
</div>
</section>
</body>
</html>
