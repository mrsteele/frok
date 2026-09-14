# Your library and asset links

A creation is a **group**: its starting asset, video takes, and enhanced copies. Envision and Favorites show one card per group, using its latest asset. One heart saves or unsaves the entire group.

## Find your work

| View | What it shows |
| --- | --- |
| Envision | All retained creations grouped by prompt, newest sections first |
| Favorites | Saved groups, with image and video filters |

Filters use the latest asset shown on the group card. An image with video takes appears as a video creation. Envision keeps its sections after refresh. New idea clears only the composer. Collapse a section or use Jump to prompt to move around; Show older prompts reveals earlier sections. Older History links redirect to Envision.

## Stable asset addresses

The root is `/asset/:id`. Video takes use short numbers under it:

```text
/asset/abc       Starting asset (number 1)
/asset/abc/2     First video take
/asset/abc/3     Second video take
/asset/abc/4     Third video take
```

The real root ID is an opaque identifier; `abc` is only an example. Arrows, dots and completed renders update the address. Refreshing or opening a copied address selects that take; Back and Forward follow your navigation.

Deleting take 3 leaves a gap. A new take after 4 gets **5**, so an old link can never silently point to a different render. A deleted take reports that it is unavailable. HD is a version of its SD take and shares the same number. Use the viewer's quality switch to compare it.

Older `/images/:id`, `/videos/:id` and `/video/:id` links resolve to the corresponding new asset address. These are local-library links, not public sharing links; another machine without the library cannot use them.

## Save and download

Save marks the group as a favorite. Video generation automatically saves the creation. If you unheart a video, its starting image and sibling videos are also unsaved.

Download exports the current image or video. If an enhanced copy exists, the download menu offers the original SD and enhanced version. A downloaded file is independent of subsequent library deletion.

## Deletion always asks first

| Action | Removed | Kept |
| --- | --- | --- |
| Delete a video take | That take and its enhanced copies | Root and other takes |
| Delete a root asset | The root and all attached takes | Unrelated creations |
| Clear unsaved | Unsaved generations eligible for deletion | Favorites and their groups, uploads, and media used by active jobs |
| Delete a prompt section | Eligible unsaved creations in that section | Favorites, even when in the section |
| Delete all my stuff | The entire library and app settings | Downloaded models, runners, pipeline files and saved API tokens |

Review the confirmation before deleting. A favorite is protected from **Clear unsaved**, but explicitly deleting its root can still delete it. Active jobs may prevent deletion of a source they need; finish or cancel the job first. Whole-library reset is in **Settings → Services**. [Storage and backups →](../storage.md)

Asset deletion removes its library media files and records. Associated job records, logs and working files are also deleted. For image batches, a log may be shared with other images; those saved images stay. Deleting a job directly or letting it expire keeps its saved media. Downloads and backups you keep separately are independent of library deletion. [What deletion removes →](../storage.md#what-deletion-removes)
