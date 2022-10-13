<html>
<head>
<title>Beer surprise!</title>
<body>
<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Include config (credentials)
require( $_SERVER['DOCUMENT_ROOT']."/../beersurprise_config.php" );

$realm = 'Restricted area';

if (empty($_SERVER['PHP_AUTH_DIGEST'])) {
    header('HTTP/1.1 401 Unauthorized');
    header('WWW-Authenticate: Digest realm="'.$realm.
           '",qop="auth",nonce="'.uniqid().'",opaque="'.md5($realm).'"');

    die("You are not authenticated.");
}

// analyze the PHP_AUTH_DIGEST variable
if (!($data = http_digest_parse($_SERVER['PHP_AUTH_DIGEST'])) ||
    $data['username'] !== ADMIN_USER )
    authenticate();
    // die('Wrong Credentials!.');

// generate the valid response
$A1 = md5($data['username'] . ':' . $realm . ':' . ADMIN_PASS);
$A2 = md5($_SERVER['REQUEST_METHOD'].':'.$data['uri']);
$valid_response = md5($A1.':'.$data['nonce'].':'.$data['nc'].':'.$data['cnonce'].':'.$data['qop'].':'.$A2);

if ($data['response'] != $valid_response)
    authenticate();
    // die('Wrong Credentials.!');

function authenticate() {
    header('WWW-Authenticate: Basic realm="Test Authentication System"');
    header('HTTP/1.0 401 Unauthorized');
    echo "You must enter a valid login ID and password to access this resource\n";
    exit;
}

// function to parse the http auth header
function http_digest_parse($txt)
{
    // protect against missing data
    $needed_parts = array('nonce'=>1, 'nc'=>1, 'cnonce'=>1, 'qop'=>1, 'username'=>1, 'uri'=>1, 'response'=>1);
    $data = array();
    $keys = implode('|', array_keys($needed_parts));

    preg_match_all('@(' . $keys . ')=(?:([\'"])([^\2]+?)\2|([^\s,]+))@', $txt, $matches, PREG_SET_ORDER);

    foreach ($matches as $m) {
        $data[$m[1]] = $m[3] ? $m[3] : $m[4];
        unset($needed_parts[$m[1]]);
    }

    return $needed_parts ? false : $data;
}

/*
users >--- groupusers ----< groups
               |
               |
               ^
         usergroupbeers
*/

$STATE= Array(
    "MALFOAMED" => -1,
    "EMPTY" => 0,
    "INSUFFICIENT_BEER" => 1,
    "DRUNK" => 13,
    "BARSTOOL_TAKEN" => 23,
    "CHEERS" => 42,
    "THE_MORE_YOU_DRINK_THE_WC" => 666,
);

// Redirect to https, if needed
if ( !isset($_SERVER[ "HTTPS" ] ) && $_SERVER["SERVER_NAME"] !== "localhost" )
{
    //header( "HTTP/1.1 301 Moved Permanently" );
    header( "Location: https://" . $_SERVER[ "HTTP_HOST" ] . $_SERVER["REQUEST_URI"] );
    exit;
}

if ( !extension_loaded( "sqlite3" ) )
{
    die( "sqlite3 is not installed (run sudo apt install php-sqlite3)" );
}

function showTable( $db, $table, $deleteButton = false )
{
    if ( $deleteButton )
    {
        echo '<form id="account" method="POST" action="'.$_SERVER["REQUEST_URI"].'">';
        echo '<input type="hidden" name="table" value="'.$table.'">';
        
    }
    echo "<h1>${table}</h1>";

    $res = $db->query( "PRAGMA table_info('${table}')" );
    $types = Array();
    while ($row = $res->fetchArray(SQLITE3_NUM))
    {
        $types[] = $row[2];
    }

    // TODO: move this to a better place (and copy over pragma query)
    echo "<!--";
    if ( $table === "usergroupbeers" && count($types) === 2 )
    {
        echo "Update table";
        $db->exec("ALTER TABLE usergroupbeers
            ADD selected INTEGER DEFAULT 0 NOT NULL
        ");
    }
    echo "-->";

    $res = $db->query( "SELECT * FROM ${table}" );
    $cols = $res->numColumns();
    
    echo '<input type="hidden" name="column" value="'.$res->columnName(0).'">';
    
    echo "<table>";
    echo "<tr>";

    if ( $deleteButton )
        echo "<th>action</th>";

    $columns = [];    
    for ( $x = 0; $x < $cols; ++$x )
    {
        $columns[] = $res->columnName($x); 
        echo "<th>".$res->columnName($x)." (" . $types[$x] . ")</th>";
    }
    echo "</tr>";
    while ($row = $res->fetchArray(SQLITE3_NUM))
    {
        echo "<tr>";
    
        if ( $deleteButton )
        {
            echo '<td>';
            echo '<input type="submit" name="command" value="delete">';
            echo '<input type="hidden" name="value" value="'.$row[0].'">';
            echo '</td>';        
        }    
        
        foreach( $row as $index => $field )
        {
            echo "<td>".$field."</td>";
        }
        echo "</tr>";
    }

    echo "</table>";
    if ( $deleteButton )
        echo '</form>';
}

function deleteEntry( $db, $table, $column, $value )
{
    // Delete the user entry
    switch ( $table )
    {
        case "users":
            $query = "DELETE FROM users WHERE `$column` = ?";
            break;
        case "groups":
            $query = "DELETE FROM groups WHERE `$column` = ?";
            break;
        case "groupusers":
            $query = "DELETE FROM groupusers WHERE `$column` = ?";
            break;
        case "usergroupbeers":
            $query = "DELETE FROM usergroupbeers WHERE `$column` = ?";
            break;
        default:
            return false;
    }
    
    echo $query."<br/>";
    $stm = $db->prepare( $query );
    
    if ( !$stm->bindValue(1, $value, SQLITE3_TEXT) )
        die( "bind value error" );
    if ( !$res = $stm->execute())
        die( "exec error" );

    $res = $db->query( "SELECT changes()" );
    $row = $res->fetchArray(SQLITE3_NUM);
    
    // Get user's guids
    //...
    
    // Delete groupuser entries
    //...
    
    // if there are no guids in groupusers, remove the group
    //...
    
    return ( $row[0] > 0 );
}

$dbFile = "../beersurprise.db";
try
{
    $db = new SQLite3( $dbFile );
}
catch ( exception $e )
{
    echo "FAILED";
    //die( "Error opening or creating database: " . $dbFile );
}

if ( $_SERVER["REQUEST_METHOD"] == "POST")
{
    // NOTE: we're not using form data ($_POST) but message body

    // Set of commands:
    switch ( $_POST["command"] )
    {
        case "delete":
            if ( !deleteEntry( $db, $_POST["table"], $_POST["column"], $_POST["value"] ) )
            {
                #die( '{"state":'.$STATE["DRUNK"].'}' );
                echo "<div>Last action failed</div>";
            }
            break;
    }

    //die( '{"state":'.$STATE["MALFOAMED"].'}' );
}

showTable( $db, "users", true );
showTable( $db, "groups", true );
showTable( $db, "groupusers", true );
showTable( $db, "usergroupbeers", true );
?>
</body>
</html>
