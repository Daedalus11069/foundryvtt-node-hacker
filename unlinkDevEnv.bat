@echo off
setlocal

set "TARGET=%localappdata%\FoundryVTT\Data\modules\foundryvtt-node-hacker"

if exist "%TARGET%" (
    echo Removing symlink: %TARGET%
    rmdir "%TARGET%"
    echo Symlink removed successfully.
) else (
    echo No symlink found at %TARGET%
)

set "TARGET=G:\herd\www\foundry-vtt-server-data\Data\modules\foundryvtt-node-hacker"

if exist "%TARGET%" (
    echo Removing symlink: %TARGET%
    rmdir "%TARGET%"
    echo Symlink removed successfully.
) else (
    echo No symlink found at %TARGET%
)

endlocal
