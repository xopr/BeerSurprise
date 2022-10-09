<?php
if ( __FILE__ === $_SERVER['SCRIPT_FILENAME'] )
    die( "500" );

define( "MARGIN", 1.25 ); // 110% of the requested amount

function groupdata($db, $post)
{
    global $STATE;

    $userhash = $post["userhash"];

    if ( !$post["passhash"] || !verifyUser( $db, $userhash, $post["passhash"] ) )
    {
        die( '{"state":'.$STATE["DRUNK"].'}' );
    }

    $result = [ "state" => $STATE["CHEERS"] ];

    if ( !isset( $post["data"] ) )
    {
        // Return all group GUIDs for this user
        $result[ "group" ] = [];
        $stm = $db->prepare('SELECT guid FROM groupusers WHERE user = ?');
        $stm->bindValue(1, $userhash, SQLITE3_TEXT);
        $res = $stm->execute();

        while ( ( $row = $res->fetchArray(SQLITE3_ASSOC) ) !== false )
            $result[ "group" ][] = $row[ "guid" ];
    }
    else if ( isset( $post["data"]["group"] ) )
    {
        // Do all magic for a group here:                
        $guid = $post["data"]["group"];
        // Optional invite token
        $token = isset( $post["data"]["token"] ) ? $post["data"]["token"] : null;

        // Check for guid existence and membership
        $stm = $db->prepare('SELECT user, amount FROM groupusers LEFT JOIN groups ON groupusers.guid = groups.guid WHERE groupusers.guid = ?');
        $stm->bindValue(1, $guid, SQLITE3_TEXT);
        $res = $stm->execute();

        // null means: non-existant
        $allowed = null;
        $requestedAmount = null;
        while ( ( $row = $res->fetchArray(SQLITE3_ASSOC) ) !== false )
        {
            // group exists, check permission
            $allowed = false;
            if ( $row["user"] === $userhash )
            {
                // User is in the group
                $allowed = true;
                $requestedAmount = $row["amount"];
                break;
            }

            if ( $token && $row["user"] === $token )
            {
                // User provided a "token" (another user id within the group)
                $allowed = true;
                $requestedAmount = $row["amount"];
                break;
            }
        }

        if ( $allowed === false )
        {
            // User is not allowed to modify this group
            // TODO: throttle IP for 2 seconds
            $result[ "state" ] = $STATE["DRUNK"];
            die( json_encode( $result ) );
        }

        if ( $allowed === null )
        {
            // Create group
            $stm = $db->prepare('INSERT INTO groups (guid, amount) VALUES( ?, ? )');
            $stm->bindValue(1, $guid, SQLITE3_TEXT);
            $stm->bindValue(2, 42, SQLITE3_INTEGER);
            $res = $stm->execute();
        }

        // "Modify" group

        // Set amount (if entry exists)
        if ( isset( $post["data"]["amount"] ) )
        {
            $stm = $db->prepare('UPDATE groups SET amount = ? WHERE guid = ?');
            $stm->bindValue(1, $post["data"]["amount"], SQLITE3_INTEGER);
            $stm->bindValue(2, $guid, SQLITE3_TEXT);
            $res = $stm->execute();

            if( !$db->changes() )
            {
                $result[ "state" ] = $STATE["MALFOAMED"];
                die( json_encode( $result ) );
            }
        }
        
        // Set group members (if entry exists)
        if ( isset( $post["data"]["members"] ) )
        {
            $stm = $db->prepare('INSERT INTO groupusers (guid, user) VALUES ( ?, ? )');
            $stm->bindValue(1, $guid, SQLITE3_TEXT);
            foreach( $post["data"]["members"] as $member )
            {
                $stm->bindValue(2, $member, SQLITE3_TEXT);
                $res = $stm->execute();
            }
        }

        // Set beers per user per group (if entry exists)
        // check given list against stored list
        // only add/delete(+usergroupbeers) deltas
        if ( isset( $post["data"]["beers"] ) )
        {
            $groupUserId = null;
            $stm = $db->prepare('SELECT id FROM groupusers WHERE guid = ? AND user = ?');
            $stm->bindValue(1, $guid, SQLITE3_TEXT);
            $stm->bindValue(2, $userhash, SQLITE3_TEXT);
            $res = $stm->execute();
            if ( ( $row = $res->fetchArray(SQLITE3_ASSOC) ) !== false )
                $groupUserId = $row[ "id" ];

            if ( $groupUserId )
            {
                $stm = $db->prepare('INSERT INTO usergroupbeers (groupuserid, beer) VALUES ( ?, ? )');
                $stm->bindValue(1, $groupUserId, SQLITE3_INTEGER);
                foreach( $post["data"]["beers"] as $beer )
                {
                    if ( !$beer )
                        continue;
                    $stm->bindValue(2, $beer, SQLITE3_TEXT);
                    $res = $stm->execute();
                }

                // Delete beers that were not listed anymore
                // Amount of questionmarks equals size of beer array
                $query = "DELETE FROM usergroupbeers WHERE groupuserid = ? AND beer NOT IN ( ".implode( ", ", array_fill( 0, count( $post["data"]["beers"] ), "?" ))." )";
                $stm = $db->prepare( $query );
                $stm->bindValue(1, $groupUserId, SQLITE3_INTEGER);
                foreach( $post["data"]["beers"] as $index => $beer )
                {
                    $stm->bindValue($index+2, $beer, SQLITE3_TEXT);
                }
                $res = $stm->execute();
            }
        }
        
        // Now do some magic and calculate the beers per user (or, INSUFFICIENT_BEER
        error_reporting(E_ALL);
        ini_set('display_errors', 1);
        $result[ "debug" ] = array( );

        $userBeers = array();
        // empty beer user: 
        $stm = $db->prepare('SELECT user, beer FROM groupusers LEFT JOIN usergroupbeers ON groupusers.id = usergroupbeers.groupuserid WHERE guid = ? ORDER BY usergroupbeers.rowid');
        // only users with beer:
        //$stm = $db->prepare('SELECT user, beer FROM usergroupbeers LEFT JOIN groupusers ON groupusers.id = usergroupbeers.groupuserid WHERE guid = ?');
        $stm->bindValue(1, $guid, SQLITE3_TEXT);
        $res = $stm->execute();
        while ( ( $row = $res->fetchArray(SQLITE3_ASSOC) ) !== false )
        {
            $userBeers[] = $row;
        }
        
        // Get distinct beers
        // Get user count
        $users = array();
        $beers = array();
        foreach ( $userBeers as $userBeer )
        {
            $user = $userBeer["user"];
            $beer = $userBeer["beer"];
            
            
            if ( !isset( $users[$user] ) )
                $users[$user] = array();
                
            // Empty beer?
            if ( !$beer )
                continue;

            if ( !isset( $beers[$beer] ) )
            {
                $beers[$beer] = array();
                // First-come-first-serve: this user deserves this beer
                $users[$user][] = $beer;
            }

            $beers[$beer][] = $user;
        }
        // calculate numBeers / userCount
        if ( array_key_exists( $userhash, $users ) )
            $personalBeers = $users[$userhash];
        else
            $personalBeers = []; // userhash not in array
        
        $userCount = count( $users );                           // number of group members
        $currentUniqueBeers = count( $beers );                  // all unique beers (distinct count) in a group
        $personalBeerCount = count( $personalBeers );           // beers entered by this user
        $beersPerUser = ceil( $requestedAmount / $userCount );  // target beer amount per user
        /*
        // user must have their beers entered and unique beers also must be matching (+10%)
        if ( ( $currentUniqueBeers < ($requestedAmount * MARGIN) ) ||
        ( $personalBeerCount < ($beersPerUser * MARGIN) ) )
        */
        // allow individual user a green light        
        if ( $currentUniqueBeers < ($requestedAmount * MARGIN ) )
            $result[ "state" ] = $STATE["INSUFFICIENT_BEER"];
        else
        {
            // There are enough unique beers.
            // Since the database is first-come-first-serve
            // we (optionally) can provide this user its list of beers (see first statement)
            $result[ "users" ] = $userCount;
            // Return the minimal viable set
            $result[ "beers" ] = array_slice( $personalBeers, 0, $beersPerUser );// undefined index
        }

        $result[ "debug" ] = $userBeers;
        $result[ "debug" ]["beers"] = $currentUniqueBeers;
        $result[ "debug" ]["users"] = $userCount;
        $result[ "debug" ]["amount"] = $requestedAmount;
        $result[ "debug" ]["userbeers"] = $personalBeerCount;
        $result[ "debug" ]["userhash"] = $userhash;
        $result[ "debug" ]["users"] = $users;
    }
    else
    {
        $result[ "state" ] = $STATE["EMPTY"];
    }

    die( json_encode( $result ) );
}
?>
