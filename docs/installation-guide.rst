Installation Guide
==================

This guide is for installing GenieACS on a single server on any Linux distro
that uses *systemd* as its init system.

The various GenieACS services are independant of each other and may be
installed on different servers. You may also run multiple instances of each in
a load-balancing/failover setup.

.. attention::

  For production deployments make sure to configure TLS and change
  ``UI_JWT_SECRET`` to a unique and secure string. Refer to :ref:`https`
  section for how to enable TLS to encrypt traffic.

Prerequisites
-------------

.. topic:: Node.js

  GenieACS requires Node.js 10.x and up. Refer to https://nodejs.org/ for
  instructions.

.. topic:: MongoDB

  GenieACS requires MongoDB 3.6 and up. Refer to https://www.mongodb.com/ for
  instructions.

Install GenieACS
-------------------

.. topic:: Installing from NPM:

  .. parsed-literal::

    sudo npm install -g --unsafe-perm genieacs@\ |release|

.. topic:: Installing from source

  If you prefer installing from source, such as when running a GenieACS copy
  with custom patches, refer to README.md file in the source package. Adjust
  the next steps below accordingly.

Configure systemd
-----------------

.. topic:: Create a system user to run GenieACS daemons

  .. code:: bash

    sudo useradd --system --no-create-home --user-group genieacs

.. topic:: Create directory to save extensions and environment file

  We'll use :file:`/opt/genieacs/ext/` directory to store extension scripts (if any).

  .. code:: bash
    
    mkdir /opt/genieacs
    mkdir /opt/genieacs/ext
    chown genieacs:genieacs /opt/genieacs/ext

  Create the file :file:`/opt/genieacs/genieacs.env` to hold our configuration
  options which we pass to GenieACS as environment variables. See
  :ref:`environment-variables` section for a list of all available
  configuration options.

  .. code:: bash

    GENIEACS_CWMP_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-cwmp-access.log
    GENIEACS_NBI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-nbi-access.log
    GENIEACS_FS_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-fs-access.log
    GENIEACS_UI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-ui-access.log
    GENIEACS_DEBUG_FILE=/var/log/genieacs/genieacs-debug.yaml
    GENIEACS_EXT_DIR=/opt/genieacs/ext
    GENIEACS_UI_JWT_SECRET=secret
  
  Set file ownership and permissions:

  .. code:: bash

    sudo chown genieacs:genieacs /opt/genieacs/genieacs.env
    sudo chmod 600 /opt/genieacs/genieacs.env

.. topic:: Create logs directory

  .. code:: bash
    
    mkdir /var/log/genieacs
    chown genieacs:genieacs /var/log/genieacs

.. topic:: Create systemd unit files

  Create a systemd unit file for each of the four GenieACS services. Note that
  we're using EnvironmentFile directive to read the environment variables from
  the file we created earlier.

  Each service has two streams of logs: access log and process log. Access logs
  are configured here to be dumped in a log file under
  :file:`/var/log/genieacs/` while process logs go to *journald*. Use
  ``journalctl`` command to view process logs.

  .. attention::

    If the command :command:`systemctl edit --force --full` fails, you can
    create the unit file manually.

  1. Run the following command to create ``genieacs-cwmp`` service:
  
    .. code:: bash

      sudo systemctl edit --force --full genieacs-cwmp
    
    Then paste the following in the editor and save:

    .. code:: cfg

      [Unit]
      Description=GenieACS CWMP
      After=network.target

      [Service]
      User=genieacs
      EnvironmentFile=/opt/genieacs/genieacs.env
      ExecStart=/usr/bin/genieacs-cwmp

      [Install]
      WantedBy=default.target

  2. Run the following command to create ``genieacs-nbi`` service:
  
    .. code:: bash

      sudo systemctl edit --force --full genieacs-nbi
    
    Then paste the following in the editor and save:

    .. code:: cfg

      [Unit]
      Description=GenieACS NBI
      After=network.target

      [Service]
      User=genieacs
      EnvironmentFile=/opt/genieacs/genieacs.env
      ExecStart=/usr/bin/genieacs-nbi

      [Install]
      WantedBy=default.target

  3. Run the following command to create ``genieacs-fs`` service:
  
    .. code:: bash

      sudo systemctl edit --force --full genieacs-fs
    
    Then paste the following in the editor and save:

    .. code:: cfg

      [Unit]
      Description=GenieACS FS
      After=network.target

      [Service]
      User=genieacs
      EnvironmentFile=/opt/genieacs/genieacs.env
      ExecStart=/usr/bin/genieacs-fs

      [Install]
      WantedBy=default.target

  4. Run the following command to create ``genieacs-ui`` service:
  
    .. code:: bash

      sudo systemctl edit --force --full genieacs-ui
    
    Then paste the following in the editor and save:

    .. code:: cfg

      [Unit]
      Description=GenieACS UI
      After=network.target

      [Service]
      User=genieacs
      EnvironmentFile=/opt/genieacs/genieacs.env
      ExecStart=/usr/bin/genieacs-ui

      [Install]
      WantedBy=default.target

.. topic:: Configure log file rotation using logrotate

  Save the following as :file:`/etc/logrotate.d/genieacs`

  .. code::
  
    /var/log/genieacs/*.log /var/log/genieacs/*.yaml {
        daily
        rotate 30
        compress
        delaycompress
        dateext
    }

.. topic:: Enable and start services

  .. code:: bash

    sudo systemctl enable genieacs-cwmp
    sudo systemctl start genieacs-cwmp
    sudo systemctl status genieacs-cwmp

    sudo systemctl enable genieacs-nbi
    sudo systemctl start genieacs-nbi
    sudo systemctl status genieacs-nbi

    sudo systemctl enable genieacs-fs
    sudo systemctl start genieacs-fs
    sudo systemctl status genieacs-fs

    sudo systemctl enable genieacs-ui
    sudo systemctl start genieacs-ui
    sudo systemctl status genieacs-ui

  Review the status message for each to verify that the services are running
  successfully.
