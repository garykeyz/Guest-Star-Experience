#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int helper_path(char *destination, size_t capacity) {
  char executable[PATH_MAX];
  uint32_t size = (uint32_t)sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) return -1;

  char resolved[PATH_MAX];
  const char *source = realpath(executable, resolved) ? resolved : executable;
  const char *separator = strrchr(source, '/');
  if (!separator) return -1;

  const size_t directory_length = (size_t)(separator - source);
  const char *helper = "/GuestStarBridge.sh";
  if (directory_length + strlen(helper) + 1 > capacity) return -1;

  memcpy(destination, source, directory_length);
  destination[directory_length] = '\0';
  strcat(destination, helper);
  return 0;
}

int main(void) {
  char helper[PATH_MAX];
  if (helper_path(helper, sizeof(helper)) != 0) {
    fprintf(stderr, "No se pudo localizar el iniciador de Guest Star.\n");
    return 1;
  }

  pid_t child = fork();
  if (child < 0) {
    perror("fork");
    return 1;
  }
  if (child == 0) {
    execl("/bin/bash", "bash", helper, (char *)NULL);
    perror("execl");
    _exit(127);
  }

  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno == EINTR) continue;
    perror("waitpid");
    return 1;
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}
