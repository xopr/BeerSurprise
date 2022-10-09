<?php
if ( __FILE__ === $_SERVER['SCRIPT_FILENAME'] )
    die( "500" );

function password($db, $post)
{
    global $STATE;
    $userhash = $post["userhash"];

    if ( !$post["passhash"] )
    {
        // Create user
        if ( verifyUser( $db, $userhash ) )
        {
            // User already exists
            die( '{"state":'.$STATE["BARSTOOL_TAKEN"].'}' );
        }
        
        // Create user
        $stm = $db->prepare('INSERT INTO users (user, pass, activeweek, activeyear) VALUES( ?, ?, ?, ? )');
        $stm->bindValue(1, $userhash, SQLITE3_TEXT);
        $stm->bindValue(2, $post["data"], SQLITE3_TEXT);
        $stm->bindValue(3, date("W"), SQLITE3_INTEGER);
        $stm->bindValue(4, date("Y"), SQLITE3_INTEGER);
        //echo "REG STEP";
        $res = $stm->execute();

        if( !$db->changes() )
            die( '{"state":'.$STATE["MALFOAMED"].'}' );

        die( '{"state":'.$STATE["CHEERS"].'}' );
    }
    else
    {
        // Update password
        if ( !verifyUser( $db, $userhash, $post["passhash"] ) )
        {
            // Invalid credentials
            die( '{"state":'.$STATE["DRUNK"].'}' );
        }

        // Update user
        $stm = $db->prepare('UPDATE users SET pass = ?, activeweek = ?, activeyear = ? WHERE user = ? AND pass = ? ');
        $stm->bindValue(1, $post["data"], SQLITE3_TEXT);
        $stm->bindValue(2, date("W"), SQLITE3_INTEGER);
        $stm->bindValue(3, date("Y"), SQLITE3_INTEGER);
        $stm->bindValue(4, $userhash, SQLITE3_TEXT);
        $stm->bindValue(5, $post["passhash"], SQLITE3_TEXT);
        $res = $stm->execute();

        if( !$db->changes() )
            die( '{"state":'.$STATE["MALFOAMED"].'}' );

        die( '{"state":'.$STATE["CHEERS"].'}' );
    }
}

