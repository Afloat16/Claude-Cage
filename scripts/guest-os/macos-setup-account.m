// The only administrator created by the native installer. The durable receipt
// is root-only and binds both the directory service GUID and the numeric uid.
#import <Foundation/Foundation.h>
#import <OpenDirectory/OpenDirectory.h>
#include <pwd.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <unistd.h>

static NSString *const directory = @"/var/db/cage-initial-setup";
static NSString *const setup = @"cagesetup";

static void require(BOOL ok, const char *reason) {
    if (!ok) { fprintf(stderr, "%s\n", reason); exit(1); }
}

static NSArray *users(ODNode *node, NSString *name) {
    ODQuery *q = [ODQuery queryWithNode:node forRecordTypes:kODRecordTypeUsers
        attribute:kODAttributeTypeRecordName matchType:kODMatchEqualTo queryValues:name
        returnAttributes:@[kODAttributeTypeGUID, kODAttributeTypeUniqueID] maximumResults:2 error:NULL];
    NSArray *results = [q resultsAllowingPartial:NO error:NULL];
    require(results != nil && results.count <= 1, "Cannot identify the local guest user.");
    return results;
}

static void save(NSDictionary *d, NSURL *file) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:d options:0 error:NULL];
    require(data && [data writeToURL:file options:NSDataWritingAtomic error:NULL], "Cannot persist the guest setup receipt.");
}

static BOOL member(ODRecord *group, ODRecord *user) {
    NSError *err = nil;
    BOOL result = [group isMemberRecord:user error:&err];
    require(!err, "Cannot inspect guest administrator privileges.");
    return result;
}

static BOOL disabled(ODRecord *record) {
    NSError *error = nil;
    BOOL allowed = [record authenticationAllowedAndReturnError:&error];
    return !allowed && [error.domain isEqual:ODFrameworkErrorDomain] && error.code == kODErrorCredentialsAccountDisabled;
}

static void retire(ODNode *node, ODRecord *admin, ODRecord *record) {
    if (member(admin, record)) require([admin removeMemberRecord:record error:NULL], "Cannot revoke setup administrator privileges.");
    require(!member(admin, record), "The setup user still has administrator privileges.");
    if (!disabled(record)) {
        // Invalidate the initial guest password before disabling the account.
        // This replacement is never persisted or exposed to a caller.
        NSString *replacement = [@"Z9!" stringByAppendingString:NSUUID.UUID.UUIDString];
        require([record changePassword:nil toPassword:replacement error:NULL], "Cannot clear the temporary guest credential.");
        require([record setValue:@"/usr/bin/false" forAttribute:kODAttributeTypeUserShell error:NULL], "Cannot close the temporary login shell.");
        NSTask *task = [[NSTask alloc] init];
        task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/pwpolicy"];
        task.arguments = @[@"-n", @"/Local/Default", @"-u", setup, @"-disableuser"];
        require([task launchAndReturnError:NULL], "Cannot invoke the guest account policy tool.");
        [task waitUntilExit];
        require(task.terminationStatus == 0, "Cannot disable the temporary guest user.");
    }
    ODRecord *current = users(node, setup).firstObject;
    require(current && disabled(current) && !member(admin, current) &&
        [[current valuesForAttribute:kODAttributeTypeUserShell error:NULL].firstObject isEqual:@"/usr/bin/false"],
        "The temporary guest login remains available.");
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        BOOL prepare = argc == 3 && strcmp(argv[1], "prepare") == 0;
        require(prepare || argc == 1, "Invalid first setup operation.");
        char model[128] = {0};
        size_t size = sizeof(model);
        struct stat st;
        require(getuid() == 0 && sysctlbyname("hw.model", model, &size, NULL, 0) == 0 &&
            strncmp(model, "VirtualMac", 10) == 0 && lstat("/var/db/cage-guest-os", &st) == 0 &&
            S_ISREG(st.st_mode) && st.st_uid == 0 && !(st.st_mode & 022) &&
            [[NSString stringWithContentsOfFile:@"/var/db/cage-guest-os" encoding:NSUTF8StringEncoding error:NULL] isEqual:@"macos\n"],
            "Run as root in the selected Cage virtual Mac.");
        umask(077);
        if (prepare && mkdir(directory.fileSystemRepresentation, 0700) != 0) require(errno == EEXIST, "Cannot create private receipt directory.");
        require(lstat(directory.fileSystemRepresentation, &st) == 0 && S_ISDIR(st.st_mode) && st.st_uid == 0 && !(st.st_mode & 077),
            "Invalid private setup directory.");
        NSString *lockPath = [directory stringByAppendingPathComponent:@"lock"];
        int lock = open(lockPath.fileSystemRepresentation, O_NOFOLLOW|O_CREAT|O_RDWR, 0600);
        require(lock >= 0 && flock(lock, LOCK_EX|LOCK_NB) == 0, "Another first setup operation is running.");
        NSURL *file = [NSURL fileURLWithPath:[directory stringByAppendingPathComponent:@"account.json"]];
        NSData *data = nil;
        if (lstat(file.fileSystemRepresentation, &st) == 0) {
            require(S_ISREG(st.st_mode) && st.st_uid == 0 && !(st.st_mode & 077) && st.st_size > 0 && st.st_size <= 2048,
                "Invalid guest setup receipt.");
            data = [NSData dataWithContentsOfURL:file]; require(data != nil,"Unreadable guest setup receipt.");
        } else require(errno == ENOENT && prepare, "Missing guest setup receipt.");
        ODNode *node = [ODNode nodeWithSession:[ODSession defaultSession] name:@"/Local/Default" error:NULL];
        ODRecord *admin = [node recordWithRecordType:kODRecordTypeGroups name:@"admin" attributes:nil error:NULL];
        NSString *ordinaryName = @"cage";
        ODRecord *ordinary = users(node, ordinaryName).firstObject;
        require(node && admin && ordinary && !member(admin, ordinary), "The regular Cage user must not be a guest administrator.");
        ODRecord *record = users(node, setup).firstObject;
        NSString *install = prepare ? @(argv[2]) : nil;
        if (prepare) require([[NSUUID alloc] initWithUUIDString:install] != nil, "Invalid fresh guest installation ID.");
        NSMutableDictionary *receipt;
        if (data) {
            receipt = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:NULL];
            require([receipt isKindOfClass:NSMutableDictionary.class] &&
                [[NSUUID alloc] initWithUUIDString:receipt[@"guid"]] && [receipt[@"uid"] intValue] >= 502 &&
                [[NSUUID alloc] initWithUUIDString:receipt[@"installation"]] && (!prepare || [receipt[@"installation"] isEqual:install]),
                "The setup account belongs to a different installation.");
        } else {
            require(!record && !getpwnam("cagesetup"), "A user already has the setup name; no account was modified.");
            int uid = 502;
            while (uid < 1000 && getpwuid(uid)) uid++;
            require(uid < 1000, "No free local setup UID.");
            receipt = [@{@"installation":install, @"guid":NSUUID.UUID.UUIDString, @"uid":@(uid), @"state":@"creating"} mutableCopy];
            save(receipt, file);
        }
        NSString *uid = [receipt[@"uid"] stringValue];
        if (record) {
            NSString *guid = [record valuesForAttribute:kODAttributeTypeGUID error:NULL].firstObject;
            NSString *actualUID = [record valuesForAttribute:kODAttributeTypeUniqueID error:NULL].firstObject;
            require(guid && [guid caseInsensitiveCompare:receipt[@"guid"]] == NSOrderedSame && [actualUID isEqual:uid],
                "Refusing to modify an unrelated guest user.");
        }
        NSString *phase = receipt[@"state"];
        require([@[@"creating",@"ready",@"retiring",@"retired"] containsObject:phase], "Unknown guest setup state.");
        if (prepare) {
            require([phase isEqual:@"creating"] || [phase isEqual:@"ready"], "Initial setup has already closed.");
            char buf[258];
            require(fgets(buf,sizeof(buf),stdin) != NULL, "Missing virtual Mac login password.");
            size_t len = strcspn(buf,"\r\n");
            require(len >= 8 && len <= 256, "Invalid virtual Mac login password.");
            NSString *pw = [[NSString alloc] initWithBytes:buf length:len encoding:NSUTF8StringEncoding];
            memset_s(buf,sizeof(buf),0,sizeof(buf));
            require(pw != nil, "Invalid password encoding.");
            if (!record) {
                require([phase isEqual:@"creating"] && !getpwuid([receipt[@"uid"] intValue]), "Setup account disappeared or its UID is in use.");
                record = [node createRecordWithRecordType:kODRecordTypeUsers name:setup attributes:@{
                    kODAttributeTypeGUID:@[receipt[@"guid"]], kODAttributeTypeUniqueID:@[uid],
                    kODAttributeTypePrimaryGroupID:@[@"20"], kODAttributeTypeFullName:@[@"Cage Setup"],
                    kODAttributeTypeNFSHomeDirectory:@[@"/var/empty"], kODAttributeTypeUserShell:@[@"/bin/sh"],
                    @"dsAttrTypeNative:IsHidden":@[@"1"]
                } error:NULL];
                require(record != nil, "Cannot create the dedicated temporary guest account.");
            }
            if ([phase isEqual:@"creating"])
                require([record changePassword:nil toPassword:pw error:NULL], "Cannot initialize the temporary password.");
            require([record verifyPassword:pw error:NULL], "The stored credential does not match this guest.");
            // macOS PAM checks /etc/shells even for System Settings authorization.
            // A hidden admin with /usr/bin/false passes OD password checks but
            // authorizationhost rejects it during account management.
            if ([[record valuesForAttribute:kODAttributeTypeUserShell error:NULL].firstObject isEqual:@"/usr/bin/false"])
                require([record setValue:@"/bin/sh" forAttribute:kODAttributeTypeUserShell error:NULL], "Cannot repair the temporary account's login shell.");
            if (!member(admin, record)) require([admin addMemberRecord:record error:NULL], "Cannot grant temporary setup privileges.");
            require(member(admin, record), "Guest setup privileges were not applied.");
            receipt[@"state"] = @"ready";
        } else {
            require(![phase isEqual:@"creating"], "The temporary account has not completed setup.");
            if (![phase isEqual:@"retired"]) {
                receipt[@"state"] = @"retiring"; save(receipt,file);
            }
            // Keep the disabled directory record. Its home is the shared system
            // directory /var/empty and must never be processed as a deletable home.
            if (record) retire(node, admin, record);
            require(!member(admin,ordinary), "The regular Cage user is a guest administrator.");
            receipt[@"state"] = @"retired";
        }
        save(receipt,file);
        close(lock);
        return 0;
    }
}
