Requirements
------------
* php
* sqlite3

Administration
--------------
There is a simple database backend management when visiting `db.php`.
This requires `beersurprise_config.php` at websites parent directory with the following contents:
```
<?php
const ADMIN_USER = "<your_desired_username>";
const ADMIN_PASS = "<your_administrative_password>";
```
