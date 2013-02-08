#!/usr/bin/perl
use Digest::MD5 qw(md5_base64);
use URI::Escape;
print "Enter the details *exactly* as sent in device TR-069 informs (case sensitive).\n";
print 'Serial number: ';
chomp($serial = <>);
$serial = uri_escape($serial, '^A-Za-z0-9_');

print 'OUI: ';
chomp($oui = <>);
$oui = uri_escape($oui, '^A-Za-z0-9_');

print 'Product class (leave blank if not available): ';
chomp($product_class = <>);
$product_class = uri_escape($product_class, '^A-Za-z0-9_');

if ($product_class eq '') {
  $device_id = "$oui-$serial"
}
else {
  $device_id = "$oui-$product_class-$serial"
}

print "ACS username: $device_id\n";
print 'ACS password: ' . md5_base64("${device_id} Open Sesame") . "\n";
print "Connection request username: $device_id\n";
print 'Connection request password: ' . md5_base64("${device_id} Sesame, open") . "\n";
