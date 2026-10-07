#!/bin/sh
# Emits the shared <head> for a commercial page: $1 title, $2 canonical path,
# $3 description, $4 keywords, $5 og:title, $6 og:description
cat <<HEAD
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$1</title>
    <link rel="canonical" href="https://thetechhut.co$2">

    <meta name="description" content="$3">
    <meta name="keywords" content="$4">

    <meta property="og:type" content="website">
    <meta property="og:title" content="$5">
    <meta property="og:description" content="$6">
    <meta property="og:url" content="https://thetechhut.co$2">
    <meta name="twitter:card" content="summary_large_image">

    <link rel="icon" type="image/png" sizes="32x32"
        href="https://images.unsplash.com/photo-1698767008609-f5fa6137b9e6?q=80&amp;w=32&amp;h=32&amp;auto=format&amp;fit=crop">
    <link rel="apple-touch-icon" sizes="180x180"
        href="https://images.unsplash.com/photo-1698767008609-f5fa6137b9e6?q=80&amp;w=180&amp;h=180&amp;auto=format&amp;fit=crop">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        rel="stylesheet">

HEAD
